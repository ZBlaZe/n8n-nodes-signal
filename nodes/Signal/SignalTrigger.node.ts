import {
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    ITriggerFunctions,
    ITriggerResponse,
    NodeApiError,
} from 'n8n-workflow';
import { WebSocket } from 'ws';
import { createAxiosConfig, retryRequest } from './shared';
import axios from 'axios';

// Signal's protocol content-type for a message's overflow text. When a message body exceeds
// ~2KB, the sending client truncates `dataMessage.message` and ships the FULL original text as
// a pseudo-attachment of this type instead (see Signal-Android's MessageUtil.getSplitMessage,
// MAX_INLINE_BODY_SIZE_BYTES). It's not a file the sender attached, so this node downloads its
// content to restore the untruncated text and drops it from the emitted `attachments` list.
const LONG_TEXT_ATTACHMENT_CONTENT_TYPE = 'text/x-signal-plain';

function parseFilterList(raw: string): string[] {
    return raw
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

function matchesFilter(mode: string, list: string[], values: string[]): boolean {
    if (mode === 'none') {
        return true;
    }
    const isListed = values.some((value) => value && list.includes(value));
    return mode === 'whitelist' ? isListed : !isListed;
}

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
            {
                displayName: 'Ignore Poll Votes',
                name: 'ignorePollVotes',
                type: 'boolean',
                default: false,
                description: 'Whether to ignore incoming poll votes',
            },
            {
                displayName: 'Filters',
                name: 'filters',
                type: 'collection',
                placeholder: 'Add Filter',
                default: {},
                description: 'Restrict which groups or contacts can trigger this node, to reduce load on n8n',
                options: [
                    {
                        displayName: 'Group Filter Mode',
                        name: 'groupFilterMode',
                        type: 'options',
                        options: [
                            { name: 'None', value: 'none' },
                            { name: 'Whitelist', value: 'whitelist' },
                            { name: 'Blacklist', value: 'blacklist' },
                        ],
                        default: 'none',
                        description: 'Whether to restrict which groups trigger this node',
                    },
                    {
                        displayName: 'Groups',
                        name: 'groupFilterList',
                        type: 'string',
                        typeOptions: {
                            rows: 4,
                        },
                        default: '',
                        placeholder: 'group-internal-id-1\ngroup-internal-id-2',
                        description: 'Group internal IDs to whitelist/blacklist, one per line (or comma-separated)',
                        displayOptions: {
                            hide: {
                                groupFilterMode: ['none'],
                            },
                        },
                    },
                    {
                        displayName: 'Contact Filter Mode',
                        name: 'contactFilterMode',
                        type: 'options',
                        options: [
                            { name: 'None', value: 'none' },
                            { name: 'Whitelist', value: 'whitelist' },
                            { name: 'Blacklist', value: 'blacklist' },
                        ],
                        default: 'none',
                        description: 'Whether to restrict which senders trigger this node',
                    },
                    {
                        displayName: 'Contacts',
                        name: 'contactFilterList',
                        type: 'string',
                        typeOptions: {
                            rows: 4,
                        },
                        default: '',
                        placeholder: '+1234567890\nsender-uuid',
                        description: 'Sender phone numbers or UUIDs to whitelist/blacklist, one per line (or comma-separated)',
                        displayOptions: {
                            hide: {
                                contactFilterMode: ['none'],
                            },
                        },
                    },
                ],
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
        const ignorePollVotes = this.getNodeParameter('ignorePollVotes', 0) as boolean;
        const filters = this.getNodeParameter('filters', 0, {}) as {
            groupFilterMode?: string;
            groupFilterList?: string;
            contactFilterMode?: string;
            contactFilterList?: string;
        };
        const groupFilterMode = filters.groupFilterMode || 'none';
        const groupFilterList = parseFilterList(filters.groupFilterList || '');
        const contactFilterMode = filters.contactFilterMode || 'none';
        const contactFilterList = parseFilterList(filters.contactFilterList || '');

        const wsUrl = `${apiUrl.replace('http', 'ws')}/v1/receive/${phoneNumber}`;
        this.logger.debug(`SignalTrigger: Attempting to connect to WS URL: ${wsUrl}`);
        const processedMessages = new Set<number>();
        const maxMessages = 1000;

        let ws: WebSocket | null = null;
        let reconnectTimeout: NodeJS.Timeout | null = null;
        let isClosed = false;

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

            ws.on('message', async (data: Buffer) => {
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

                        const dataMessage = message.envelope?.dataMessage;

                        const groupInternalId: string = dataMessage?.groupInfo?.groupId || '';
                        if (groupInternalId && !matchesFilter(groupFilterMode, groupFilterList, [groupInternalId])) {
                            this.logger.debug(`SignalTrigger: Skipping message with timestamp ${timestamp} due to group filter`);
                            return;
                        }

                        const sourceNumber: string = message.envelope?.sourceNumber || '';
                        const sourceUuid: string = message.envelope?.sourceUuid || '';
                        if (!matchesFilter(contactFilterMode, contactFilterList, [sourceNumber, sourceUuid])) {
                            this.logger.debug(`SignalTrigger: Skipping message with timestamp ${timestamp} due to contact filter`);
                            return;
                        }

                        const pollVote = dataMessage?.pollVote || null;
                        const messageType = message.envelope?.syncMessage ? 'outgoing' : 'incoming';

                        const rawAttachments: Array<{ contentType?: string; id?: string }> = dataMessage?.attachments || [];
                        const longTextAttachment = rawAttachments.find(
                            (attachment) => attachment?.contentType === LONG_TEXT_ATTACHMENT_CONTENT_TYPE,
                        );
                        const attachments = rawAttachments.filter((attachment) => attachment !== longTextAttachment);

                        let messageText: string = dataMessage?.message || '';
                        if (longTextAttachment?.id) {
                            try {
                                const attachmentResponse = await retryRequest(() =>
                                    axios.get(`${apiUrl}/v1/attachments/${longTextAttachment.id}`, {
                                        ...createAxiosConfig(apiToken, 30000),
                                        responseType: 'arraybuffer',
                                    })
                                );
                                if (attachmentResponse?.data && attachmentResponse.data.byteLength > 0) {
                                    messageText = Buffer.from(attachmentResponse.data).toString('utf-8');
                                    this.logger.debug(`SignalTrigger: Restored full long-text message (${messageText.length} chars) from attachment '${longTextAttachment.id}' for timestamp ${timestamp}`);
                                }
                            } catch (error) {
                                this.logger.warn(`SignalTrigger: Failed to fetch long-text attachment '${longTextAttachment.id}' for timestamp ${timestamp}; messageText stays truncated`, { error });
                            }
                        }

                        const processedMessage = {
                            messageText,
                            attachments,
                            reactions: dataMessage?.reaction || [],
                            pollVote: pollVote ? {
                                author: pollVote.author || '',
                                authorNumber: pollVote.authorNumber || '',
                                authorUuid: pollVote.authorUuid || '',
                                targetSentTimestamp: pollVote.targetSentTimestamp || 0,
                                optionIndexes: pollVote.optionIndexes || [],
                                voteCount: pollVote.voteCount || 0,
                            } : null,
                            sourceDevice: message.envelope?.sourceDevice || 0,
                            sourceName: message.envelope?.sourceName || '',
                            sourceNumber: message.envelope?.sourceNumber || '',
                            sourceUuid: message.envelope?.sourceUuid || '',
                            groupInternalId: dataMessage?.groupInfo?.groupId || '',
                            groupName: dataMessage?.groupInfo?.groupName || '',
                            timestamp,
                            account: message.account || '',
                            hasContent: message.envelope?.hasContent || false,
                            isUnidentifiedSender: message.envelope?.isUnidentifiedSender || false,
                            messageType,
                            envelope: message.envelope || {},
                        };

                        this.logger.debug(`SignalTrigger: Processed message content: ${JSON.stringify(processedMessage, null, 2)}`);

                        // Filter: skip if no meaningful content
                        const hasContent =
                            processedMessage.messageText ||
                            processedMessage.attachments.length > 0 ||
                            processedMessage.reactions.length > 0 ||
                            processedMessage.pollVote !== null;

                        if (!hasContent) {
                            this.logger.debug(`SignalTrigger: Skipping empty message with timestamp ${timestamp}`);
                            return;
                        }

                        // Filter: skip based on ignore settings
                        if (
                            (ignoreMessages && processedMessage.messageText) ||
                            (ignoreAttachments && processedMessage.attachments.length > 0) ||
                            (ignoreReactions && processedMessage.reactions.length > 0) ||
                            (ignorePollVotes && processedMessage.pollVote !== null)
                        ) {
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
