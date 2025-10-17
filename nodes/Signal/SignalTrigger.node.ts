import {
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    ITriggerFunctions,
    ITriggerResponse,
    NodeApiError,
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
                description: 'Delay before reconnecting on close (in seconds)',
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
                description: 'Enable to ignore messages with text content',
            },
            {
                displayName: 'Ignore Attachments',
                name: 'ignoreAttachments',
                type: 'boolean',
                default: false,
                description: 'Enable to ignore messages with attachments',
            },
            {
                displayName: 'Ignore Reactions',
                name: 'ignoreReactions',
                type: 'boolean',
                default: false,
                description: 'Enable to ignore messages with reactions',
            },
        ],
    };

    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
        const credentials = await this.getCredentials('signalApi');
        const apiUrl = credentials.apiUrl as string;
        const apiToken = credentials.apiToken as string;
        const phoneNumber = credentials.phoneNumber as string;
        const reconnectDelay = (this.getNodeParameter('reconnectDelay', 0) as number) * 1000;
        const ignoreMessages = this.getNodeParameter('ignoreMessages', 0) as boolean;
        const ignoreAttachments = this.getNodeParameter('ignoreAttachments', 0) as boolean;
        const ignoreReactions = this.getNodeParameter('ignoreReactions', 0) as boolean;

        const wsUrl = `${apiUrl.replace('http', 'ws')}/v1/receive/${phoneNumber}`;
        this.logger.debug(`SignalTrigger: Attempting to connect to WS URL: ${wsUrl}`);
        const processedMessages = new Set<number>();
        const maxMessages = 1000;

        let ws: WebSocket | null = null;
        let reconnectTimeout: NodeJS.Timeout | null = null;
        let isClosed = false; // Flag to prevent reconnection when trigger is closed

        const connectWebSocket = () => {
            if (isClosed) {
                this.logger.debug('SignalTrigger: Trigger is closed, skipping reconnect');
                return;
            }

            ws = new WebSocket(wsUrl, {
                headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
            });

            ws.on('open', () => {
                this.logger.debug(`SignalTrigger: WebSocket connection opened to ${wsUrl}`);
            });

            ws.on('message', async(data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());

                    if (message.envelope) {
                        const timestamp = message.envelope.timestamp as number;

                        if (processedMessages.has(timestamp)) {
                            this.logger.debug(`SignalTrigger: Duplicate message with timestamp ${timestamp}, skipping`);
                            return;
                        }

                        processedMessages.add(timestamp);
                        if (processedMessages.size > maxMessages) {
                            const oldestTimestamp = Math.min(...processedMessages);
                            processedMessages.delete(oldestTimestamp);
                        }

                        const messageType = message.envelope?.syncMessage ? 'outgoing' : 'incoming';
                        const processedMessage = {
                            messageText: message.envelope?.dataMessage?.message || '',
                            attachments: message.envelope?.dataMessage?.attachments || [],
                            reactions: message.envelope?.dataMessage?.reaction || [],
                            sourceDevice: message.envelope?.sourceDevice || 0,
                            sourceName: message.envelope?.sourceName || '',
                            sourceUuid: message.envelope?.sourceUuid || '',
                            groupInternalId: message.envelope?.dataMessage?.groupInfo?.groupId || '',
                            groupName: message.envelope?.dataMessage?.groupInfo?.groupName || '',
                            timestamp: timestamp,
                            account: message.account || '',
                            hasContent: message.envelope?.hasContent || false,
                            isUnidentifiedSender: message.envelope?.isUnidentifiedSender || false,
                            messageType: messageType,
                            envelope: message.envelope || {},
                        };

                        this.logger.debug(`SignalTrigger: Processed message content: ${JSON.stringify(processedMessage, null, 2)}`);

                        // Filtering: ignore empty messages
                        if (!processedMessage.messageText && 
                            processedMessage.attachments.length === 0 && 
                            processedMessage.reactions.length === 0) {
                            this.logger.debug(`SignalTrigger: Skipping empty message with timestamp ${timestamp}`);
                            return;
                        }

                        // Filtering: ignore if enabled and corresponding content is present
                        if ((ignoreMessages && processedMessage.messageText) ||
                            (ignoreAttachments && processedMessage.attachments.length > 0) ||
                            (ignoreReactions && processedMessage.reactions.length > 0) ) {
                            this.logger.debug(`SignalTrigger: Ignoring message with timestamp ${timestamp} due to filter`);
                            return;
                        }

                        const returnData: INodeExecutionData = {
                            json: processedMessage as any,
                        };
                        this.emit([this.helpers.returnJsonArray([returnData])]);
                        this.logger.debug(`SignalTrigger: Emitted message with timestamp ${timestamp}`);
                    }
                } catch (error) {
                    this.logger.error('SignalTrigger: Error parsing message', { error });
                }
            });

            ws.on('error', (error: Error) => {
                this.logger.error('SignalTrigger: WebSocket error', { error });
                if (!isClosed) {
                    reconnectTimeout = setTimeout(connectWebSocket, reconnectDelay);
                }
            });

            ws.on('close', (code, reason) => {
                this.logger.debug(`SignalTrigger: WebSocket closed with code ${code}, reason: ${reason.toString()}`);
                if (!isClosed) {
                    reconnectTimeout = setTimeout(connectWebSocket, reconnectDelay);
                }
            });
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
                    ws.close();
                    ws = null;
                }
                this.logger.debug('SignalTrigger: WebSocket closed and reconnection stopped');
            },
        };
    }
}