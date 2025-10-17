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
            {
                displayName: 'Mark Messages as Read',
                name: 'markAsRead',
                type: 'boolean',
                default: false,
                description: 'Automatically mark processed incoming messages as read',
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
        const markAsRead = this.getNodeParameter('markAsRead', 0) as boolean;

        const wsUrl = `${apiUrl.replace('http', 'ws')}/v1/receive/${phoneNumber}`;
        this.logger.debug(`SignalTrigger: Attempting to connect to WS URL: ${wsUrl}`);
        const processedMessages = new Set<number>();
        const maxMessages = 1000;

        let ws: WebSocket | null = null;
        let reconnectTimeout: NodeJS.Timeout | null = null;
        let isClosed = false; // Flag to prevent reconnection when trigger is closed

        // Function to mark a message as read
        const markMessageAsRead = async (sourceNumber: string, sourceUuid: string, timestamp: number) => {
            try {
                const readReceiptUrl = `${apiUrl}/v1/receipts/${phoneNumber}`;
                const requestBody = {
                    receipt_type: "read",
                    recipient: sourceUuid,
                    timestamp: timestamp
                };

                this.logger.debug(`SignalTrigger: Sending read read receipt - URL: ${readReceiptUrl}, Body: ${JSON.stringify(requestBody)}`);

                const response = await fetch(readReceiptUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiToken && { Authorization: `Bearer ${apiToken}` }),
                    },
                    body: JSON.stringify(requestBody),
                });

                if (response.ok) {
                    this.logger.debug(`SignalTrigger: Successfully marked message as read for ${sourceUuid}, timestamp: ${timestamp}`);
                } else {
                    const errorText = await response.text();
                    this.logger.warn(`SignalTrigger: Failed to mark message as read: ${response.status} ${errorText}`);
                }
            } catch (error) {
                this.logger.error(`SignalTrigger: Error marking message as read`, { error });
            }
        };

        const connectWebSocket = () => {
            if (isClosed) {
                this.logger.debug(`SignalTrigger: Trigger is closed, skipping reconnection`);
                return;
            }

            ws = new WebSocket(wsUrl, {
                headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
            });

            ws.on('open', () => {
                this.logger.debug(`SignalTrigger: Successfully connected to ${wsUrl}`);
            });

            ws.on('message', async (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    const timestamp = message.envelope?.timestamp || 0;
                    if (processedMessages.has(timestamp)) {
                        this.logger.debug(`SignalTrigger: Skipping duplicate message with timestamp ${timestamp}`);
                        return;
                    }
                    if (processedMessages.size >= maxMessages) {
                        processedMessages.clear();
                    }
                    processedMessages.add(timestamp);

                    const dataMsg = message.envelope?.dataMessage || message.envelope?.syncMessage?.sentMessage || {};
                    
                    // Determine the message type based on the envelope structure
                    const hasDataMessage = !!message.envelope?.dataMessage;
                    const hasSyncMessage = !!message.envelope?.syncMessage;
                    
                    let shouldProcess = false;
                    let messageType = 'unknown';
                    
                    if (hasDataMessage) {
                        // Incoming message - process
                        shouldProcess = true;
                        messageType = 'incoming';
                        this.logger.debug(`SignalTrigger: Incoming message detected`);
                    } else if (hasSyncMessage) {
                        const sentMessage = message.envelope.syncMessage.sentMessage;
                        const sourceUuid = message.envelope.sourceUuid;
                        const destinationUuid = sentMessage?.destinationUuid;
                        
                        if (sourceUuid === destinationUuid) {
                            // Message to self - process
                            shouldProcess = true;
                            messageType = 'self_note';
                            this.logger.debug(`SignalTrigger: Self note detected`);
                        } else {
                            // Outgoing message to someone else - DO NOT process
                            shouldProcess = false;
                            messageType = 'outgoing';
                            this.logger.debug(`SignalTrigger: Outgoing message detected - skipping`);
                        }
                    }
                    
                    if (!shouldProcess) {
                        this.logger.debug(`SignalTrigger: Skipping message type: ${messageType} with timestamp ${timestamp}`);
                        return;
                    }
                    
                    const processedMessage = {
                        messageText: dataMsg.message || '',
                        attachments: dataMsg.attachments || [],
                        reactions: dataMsg.reactions || [],
                        sourceNumber: message.envelope?.sourceNumber || '',
                        sourceUuid: message.envelope?.sourceUuid || '',
                        sourceName: message.envelope?.sourceName || '',
                        timestamp: timestamp,
                        serverReceivedTimestamp: message.envelope?.serverReceivedTimestamp || 0,
                        serverDeliveredTimestamp: message.envelope?.serverDeliveredTimestamp || 0,
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
                        (ignoreReactions && processedMessage.reactions.length > 0)) {
                        this.logger.debug(`SignalTrigger: Ignoring message with timestamp ${timestamp} due to filter`);
                        return;
                    }

                    const returnData: INodeExecutionData = {
                        json: processedMessage as any,
                    };
                    this.emit([this.helpers.returnJsonArray([returnData])]);
                    this.logger.debug(`SignalTrigger: Emitted message with timestamp ${timestamp}`);

                    // Mark the message as read if it's an incoming message and the option is enabled
                    if (markAsRead && messageType === 'incoming') {
                        await markMessageAsRead(
                            processedMessage.sourceNumber,
                            processedMessage.sourceUuid,
                            timestamp
                        );
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