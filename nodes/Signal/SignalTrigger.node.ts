import {
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    ITriggerFunctions,
    ITriggerResponse,
} from 'n8n-workflow';
import { WebSocket } from 'ws';

export class SignalTrigger implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Signal Trigger',
        name: 'signalTrigger',
        icon: 'file:signal.svg',
        group: ['trigger'],
        version: 1,
        description: 'Triggers on new Signal messages via signal-cli-rest-api WebSocket',
        defaults: {
            name: 'Signal Trigger',
        },
        inputs: [],
        outputs: ['main'],
        credentials: [
            {
                name: 'signalApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Reconnect Delay (seconds)',
                name: 'reconnectDelay',
                type: 'number',
                default: 5,
                description: 'Base delay before reconnecting on close (in seconds). Uses exponential backoff.',
                typeOptions: {
                    minValue: 1,
                    maxValue: 60,
                },
            },
            {
                displayName: 'Ignore Messages',
                name: 'ignoreMessages',
                type: 'boolean',
                default: false,
                description: 'Whether to ignore messages with text content',
            },
            {
                displayName: 'Ignore Attachments',
                name: 'ignoreAttachments',
                type: 'boolean',
                default: false,
                description: 'Whether to ignore messages with attachments',
            },
            {
                displayName: 'Ignore Reactions',
                name: 'ignoreReactions',
                type: 'boolean',
                default: false,
                description: 'Whether to ignore messages with reactions',
            },
        ],
    };

    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
        const credentials = await this.getCredentials('signalApi');
        const apiUrl = credentials.apiUrl as string;
        const apiToken = credentials.apiToken as string;
        const phoneNumber = credentials.phoneNumber as string;
        const baseReconnectDelay = (this.getNodeParameter('reconnectDelay', 0) as number) * 1000;
        const ignoreMessages = this.getNodeParameter('ignoreMessages', 0) as boolean;
        const ignoreAttachments = this.getNodeParameter('ignoreAttachments', 0) as boolean;
        const ignoreReactions = this.getNodeParameter('ignoreReactions', 0) as boolean;

        const wsUrl = `${apiUrl.replace(/^http/, 'ws')}/v1/receive/${phoneNumber}`;
        this.logger.debug(`SignalTrigger: Connecting to ${wsUrl}`);

        // Bounded queue — no spread operator, O(1) operations
        const processedTimestamps: number[] = [];
        const MAX_TIMESTAMPS = 1000;

        const hasProcessed = (ts: number): boolean => processedTimestamps.includes(ts);
        const markProcessed = (ts: number): void => {
            if (processedTimestamps.length >= MAX_TIMESTAMPS) {
                processedTimestamps.shift(); // remove oldest
            }
            processedTimestamps.push(ts);
        };

        let ws: WebSocket | null = null;
        let reconnectTimeout: NodeJS.Timeout | null = null;
        let isClosed = false;
        let reconnectAttempt = 0;
        const MAX_RECONNECT_DELAY = 60_000;

        const connectWebSocket = (): void => {
            if (isClosed) return;

            ws = new WebSocket(wsUrl, {
                headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
            });

            ws.on('open', () => {
                reconnectAttempt = 0;
                this.logger.debug('SignalTrigger: WebSocket connected');
            });

            ws.on('message', (data: Buffer) => {
                // Intentionally NOT async — prevents unhandled rejection from crashing n8n.
                // All async work is wrapped and errors are caught explicitly.
                let message: any;
                try {
                    message = JSON.parse(data.toString());
                } catch (parseError) {
                    this.logger.error('SignalTrigger: Failed to parse message JSON', { parseError });
                    return;
                }

                if (!message?.envelope) return;

                const timestamp = message.envelope.timestamp as number;

                if (hasProcessed(timestamp)) {
                    this.logger.debug(`SignalTrigger: Duplicate timestamp ${timestamp}, skipping`);
                    return;
                }
                markProcessed(timestamp);

                const dataMessage = message.envelope?.dataMessage;
                const messageText: string = dataMessage?.message || '';
                const attachments: unknown[] = dataMessage?.attachments || [];
                const reactions: unknown[] = dataMessage?.reaction ? [dataMessage.reaction] : [];

                // Skip empty messages
                if (!messageText && attachments.length === 0 && reactions.length === 0) {
                    this.logger.debug(`SignalTrigger: Skipping empty message ${timestamp}`);
                    return;
                }

                // Apply filters
                if (
                    (ignoreMessages && messageText) ||
                    (ignoreAttachments && attachments.length > 0) ||
                    (ignoreReactions && reactions.length > 0)
                ) {
                    this.logger.debug(`SignalTrigger: Filtered out message ${timestamp}`);
                    return;
                }

                const processedMessage = {
                    messageText,
                    attachments,
                    reactions,
                    sourceDevice: message.envelope?.sourceDevice || 0,
                    sourceName: message.envelope?.sourceName || '',
                    sourceUuid: message.envelope?.sourceUuid || '',
                    groupInternalId: dataMessage?.groupInfo?.groupId || '',
                    groupName: dataMessage?.groupInfo?.groupName || '',
                    timestamp,
                    account: message.account || '',
                    hasContent: message.envelope?.hasContent || false,
                    isUnidentifiedSender: message.envelope?.isUnidentifiedSender || false,
                    messageType: message.envelope?.syncMessage ? 'outgoing' : 'incoming',
                    envelope: message.envelope || {},
                };

                this.logger.debug(`SignalTrigger: Emitting message ${timestamp}`);

                // Guard: do not emit after close
                if (isClosed) return;

                try {
                    const returnData: INodeExecutionData = { json: processedMessage as any };
                    this.emit([this.helpers.returnJsonArray([returnData])]);
                } catch (emitError) {
                    this.logger.error('SignalTrigger: Failed to emit message', { emitError });
                }
            });

            ws.on('error', (error: Error) => {
                this.logger.error('SignalTrigger: WebSocket error', { error: error.message });
                scheduleReconnect();
            });

            ws.on('close', (code: number, reason: Buffer) => {
                this.logger.debug(`SignalTrigger: WebSocket closed — code=${code} reason=${reason.toString()}`);
                scheduleReconnect();
            });
        };

        const scheduleReconnect = (): void => {
            if (isClosed || reconnectTimeout) return;

            // Exponential backoff: base * 2^attempt, capped at MAX_RECONNECT_DELAY
            const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
            reconnectAttempt++;
            this.logger.debug(`SignalTrigger: Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);

            reconnectTimeout = setTimeout(() => {
                reconnectTimeout = null;
                connectWebSocket();
            }, delay);
        };

        connectWebSocket();

        return {
            closeFunction: async () => {
                isClosed = true;
                if (reconnectTimeout) {
                    clearTimeout(reconnectTimeout);
                    reconnectTimeout = null;
                }
                if (ws) {
                    ws.removeAllListeners();
                    ws.close();
                    ws = null;
                }
                this.logger.debug('SignalTrigger: Closed cleanly');
            },
        };
    }
}
