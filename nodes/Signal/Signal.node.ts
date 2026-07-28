import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeApiError,
} from 'n8n-workflow';
import { executeMessagesOperation } from './messages';
import { executeGroupsOperation } from './groups';
import { executeContactsOperation } from './contacts';
import { executeAttachmentsOperation } from './attachments';
import { executePollsOperation } from './polls';
import { executeSearchOperation } from './search';
import { coerceToNumber } from './shared';

// Single source of truth for which operations belong to each resource group.
// Referenced both by the field `displayOptions` below and by the routing in `execute()`,
// so adding/removing an operation only requires updating one array.
const MESSAGE_OPERATIONS = ['sendMessage', 'sendReaction', 'removeReaction', 'startTyping', 'stopTyping', 'markAsRead', 'replyMessage', 'forwardMessage'];
const MESSAGE_TEXT_OPERATIONS = ['sendMessage', 'replyMessage', 'forwardMessage'];
const BINARY_ATTACHMENT_OPERATIONS = ['sendMessage', 'replyMessage'];
const REACTION_TARGET_OPERATIONS = ['sendReaction', 'removeReaction', 'replyMessage'];
const TIMESTAMP_TARGET_OPERATIONS = ['sendReaction', 'removeReaction', 'markAsRead', 'replyMessage'];
const ATTACHMENT_OPERATIONS = ['listAttachments', 'downloadAttachment', 'removeAttachment'];
const ATTACHMENT_ID_OPERATIONS = ['downloadAttachment', 'removeAttachment'];
const GROUP_OPERATIONS = ['getGroups', 'createGroup', 'updateGroup'];
const GROUP_WRITE_OPERATIONS = ['createGroup', 'updateGroup'];
const POLL_OPERATIONS = ['createPoll', 'closePoll', 'votePoll'];
const CONTACT_OPERATIONS = ['getContacts'];
const SEARCH_OPERATIONS = ['searchContacts'];

const RECIPIENT_OPERATIONS = [...MESSAGE_OPERATIONS, ...POLL_OPERATIONS];
const TIMEOUT_OPERATIONS = [
    ...MESSAGE_OPERATIONS,
    ...CONTACT_OPERATIONS,
    ...GROUP_OPERATIONS,
    ...ATTACHMENT_OPERATIONS,
    ...POLL_OPERATIONS,
    ...SEARCH_OPERATIONS,
];

export class Signal implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Signal',
        name: 'signal',
        icon: 'file:signal.svg',
        group: ['output'],
        version: 1,
        description: 'Interact with Signal via signal-cli-rest-api',
        defaults: {
            name: 'Signal',
        },
        inputs: ['main'],
        outputs: ['main'],
        credentials: [
            {
                name: 'signalApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                default: '',
                options: [
                    {
                        name: 'Messages: Send Message',
                        value: 'sendMessage',
                        description: 'Send a text message to a contact or group, optionally with attachments',
                        action: 'Send a text message',
                    },
                    {
                        name: 'Messages: Send Reaction',
                        value: 'sendReaction',
                        description: 'Send a reaction (emoji) to a message',
                        action: 'Send a reaction',
                    },
                    {
                        name: 'Messages: Remove Reaction',
                        value: 'removeReaction',
                        description: 'Remove a reaction from a message',
                        action: 'Remove a reaction',
                    },
                    {
                        name: 'Messages: Start Typing',
                        value: 'startTyping',
                        description: 'Show typing indicator to recipient',
                        action: 'Start typing indicator',
                    },
                    {
                        name: 'Messages: Stop Typing',
                        value: 'stopTyping',
                        description: 'Stop showing typing indicator to recipient',
                        action: 'Stop typing indicator',
                    },
                    {
                        name: 'Messages: Mark As Read',
                        value: 'markAsRead',
                        description: 'Mark a message as read',
                        action: 'Mark as read',
                    },
                    {
                        name: 'Messages: Reply Message',
                        value: 'replyMessage',
                        description: 'Reply to a specific message with a quote reference',
                        action: 'Reply to a message',
                    },
                    {
                        name: 'Messages: Forward Message',
                        value: 'forwardMessage',
                        description: 'Forward a message, including its attachments, to another contact or group',
                        action: 'Forward a message',
                    },
                    {
                        name: 'Attachments: List Attachments',
                        value: 'listAttachments',
                        description: 'List attachments for the account',
                        action: 'List attachments',
                    },
                    {
                        name: 'Attachments: Download Attachment',
                        value: 'downloadAttachment',
                        description: 'Download an attachment as binary file',
                        action: 'Download attachment',
                    },
                    {
                        name: 'Attachments: Remove Attachment',
                        value: 'removeAttachment',
                        description: 'Remove an attachment',
                        action: 'Remove attachment',
                    },
                    {
                        name: 'Contacts: Get Contacts',
                        value: 'getContacts',
                        description: 'Get the list of contacts for the account',
                        action: 'Get contacts',
                    },
                    {
                        name: 'Groups: Get Groups',
                        value: 'getGroups',
                        description: 'Get the list of groups for the account',
                        action: 'Get groups',
                    },
                    {
                        name: 'Groups: Create Group',
                        value: 'createGroup',
                        description: 'Create a new Signal group',
                        action: 'Create a group',
                    },
                    {
                        name: 'Groups: Update Group',
                        value: 'updateGroup',
                        description: 'Update a Signal group\'s name or members',
                        action: 'Update a group',
                    },
                    {
                        name: 'Polls: Create Poll',
                        value: 'createPoll',
                        description: 'Create a new poll and send it to a contact or group',
                        action: 'Create a poll',
                    },
                    {
                        name: 'Polls: Close Poll',
                        value: 'closePoll',
                        description: 'Close an existing poll',
                        action: 'Close a poll',
                    },
                    {
                        name: 'Polls: Vote on Poll',
                        value: 'votePoll',
                        description: 'Submit a vote on a poll',
                        action: 'Vote on a poll',
                    },
                    {
												name: 'Search: Search Numbers',
												value: 'searchContacts',
												description: 'Check if one or more phone numbers are registered with Signal',
												action: 'Search numbers',
										},
                ],
            },
            // ─── Recipient (shared) ───────────────────────────────────────────
            {
                displayName: 'Recipient',
                name: 'recipient',
                type: 'string',
                default: '',
                placeholder: '+1234567890 or group.XXXX==',
                description: 'Phone number, username, or group ID',
                required: true,
                displayOptions: {
                    show: {
                        operation: RECIPIENT_OPERATIONS,
                    },
                },
            },
            // ─── Messages ────────────────────────────────────────────────────
            {
                displayName: 'Message',
                name: 'message',
                type: 'string',
                default: '',
                description: 'The text message to send (optional for attachments)',
                displayOptions: {
                    show: {
                        operation: MESSAGE_TEXT_OPERATIONS,
                    },
                },
            },
            {
                displayName: 'Binary Fields',
                name: 'binaryFields',
                type: 'fixedCollection',
                typeOptions: {
                    multipleValues: true,
                },
                default: {},
                placeholder: 'Add Binary Field',
                description: 'Binary fields for attachments (empty or invalid fields are ignored)',
                displayOptions: {
                    show: {
                        operation: BINARY_ATTACHMENT_OPERATIONS,
                    },
                },
                options: [
                    {
                        name: 'binaryFieldValues',
                        displayName: 'Binary Field',
                        values: [
                            {
                                displayName: 'Input Binary Field',
                                name: 'inputBinaryField',
                                type: 'string',
                                default: '',
                                description: 'Name of the binary field containing the file to send (e.g., data)',
                            },
                        ],
                    },
                ],
            },
            {
                displayName: 'Source Attachment IDs',
                name: 'sourceAttachmentIds',
                type: 'string',
                default: '',
                placeholder: 'attachment_id_1.jpg,attachment_id_2.png',
                description: 'Comma-separated attachment IDs already stored on the server (e.g. from the Signal Trigger\'s "attachments" field) to fetch and send along with the message — use this to forward a received attachment without downloading it separately',
                displayOptions: {
                    show: {
                        operation: ['forwardMessage'],
                    },
                },
            },
            // ─── Groups ──────────────────────────────────────────────────────
            {
                displayName: 'Group ID',
                name: 'groupId',
                type: 'string',
                default: '',
                placeholder: 'group.XXXXXXXXXXXXXXXXXXXXXXXXXX==',
                description: 'ID of the group to update',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['updateGroup'],
                    },
                },
            },
            {
                displayName: 'Group Name',
                name: 'groupName',
                type: 'string',
                default: '',
                description: 'Name of the group to create or update',
                displayOptions: {
                    show: {
                        operation: GROUP_WRITE_OPERATIONS,
                    },
                },
            },
            {
                displayName: 'Group Members',
                name: 'groupMembers',
                type: 'string',
                default: '',
                placeholder: '+1234567890,+0987654321',
                description: 'Comma-separated list of phone numbers to add to the group',
                displayOptions: {
                    show: {
                        operation: GROUP_WRITE_OPERATIONS,
                    },
                },
            },
            // ─── Reactions ───────────────────────────────────────────────────
            {
                displayName: 'Emoji',
                name: 'emoji',
                type: 'options',
                default: '👍',
                description: 'Emoji to send as a reaction (select or enter custom emoji)',
                required: true,
                typeOptions: {
                    allowCustom: true,
                },
                options: [
                    { name: 'Thumbs Up', value: '👍' },
                    { name: 'Heart', value: '❤️' },
                    { name: 'Smile', value: '😄' },
                    { name: 'Sad', value: '😢' },
                    { name: 'Angry', value: '😣' },
                    { name: 'Star', value: '⭐' },
                    { name: 'Fire', value: '🔥' },
                    { name: 'Plus', value: '➕' },
                    { name: 'Minus', value: '➖' },
                    { name: 'Handshake', value: '🤝' },
                ],
                displayOptions: {
                    show: {
                        operation: ['sendReaction'],
                    },
                },
            },
            {
                displayName: 'Target Author',
                name: 'targetAuthor',
                type: 'string',
                default: '',
                placeholder: '+1234567890 or UUID',
                description: 'Phone number or UUID of the original message\'s author',
                required: true,
                displayOptions: {
                    show: {
                        operation: REACTION_TARGET_OPERATIONS,
                    },
                },
            },
            {
                displayName: 'Target Message Timestamp',
                name: 'targetSentTimestamp',
                type: 'number',
                default: 0,
                description: 'Timestamp of the target message, in milliseconds (used for reactions, read receipts, and replies)',
                required: true,
                displayOptions: {
                    show: {
                        operation: TIMESTAMP_TARGET_OPERATIONS,
                    },
                },
            },
            {
                displayName: 'Quoted Message Text',
                name: 'quoteMessage',
                type: 'string',
                default: '',
                description: 'Text snippet of the original message, shown as the quote preview (recommended so recipients see what is being replied to)',
                displayOptions: {
                    show: {
                        operation: ['replyMessage'],
                    },
                },
            },
            // ─── Attachments ─────────────────────────────────────────────────
            {
                displayName: 'Attachment ID',
                name: 'attachmentId',
                type: 'string',
                default: '',
                placeholder: 'attachment_id_from_trigger.png',
                description: 'ID of the attachment to download or remove',
                required: true,
                displayOptions: {
                    show: {
                        operation: ATTACHMENT_ID_OPERATIONS,
                    },
                },
            },
            // ─── Polls ───────────────────────────────────────────────────────
            {
                displayName: 'Question',
                name: 'pollQuestion',
                type: 'string',
                default: '',
                placeholder: 'What\'s your favourite fruit?',
                description: 'The poll question',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['createPoll'],
                    },
                },
            },
            {
                displayName: 'Answers',
                name: 'pollAnswers',
                type: 'string',
                default: '',
                placeholder: 'apple\nbanana\norange',
                description: 'One answer per line (minimum 2 answers required)',
                required: true,
                typeOptions: {
                    rows: 4,
                },
                displayOptions: {
                    show: {
                        operation: ['createPoll'],
                    },
                },
            },
            {
                displayName: 'Allow Multiple Selections',
                name: 'pollAllowMultiple',
                type: 'boolean',
                default: false,
                description: 'Whether to allow voters to select more than one answer',
                displayOptions: {
                    show: {
                        operation: ['createPoll'],
                    },
                },
            },
            {
                displayName: 'Poll Timestamp',
                name: 'pollTimestamp',
                type: 'string',
                default: '',
                placeholder: '1769271479',
                description: 'Timestamp of the poll (returned when the poll was created)',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['closePoll', 'votePoll'],
                    },
                },
            },
            {
                displayName: 'Poll Author',
                name: 'pollAuthor',
                type: 'string',
                default: '',
                placeholder: '+1234567890 or UUID',
                description: 'Phone number or UUID of the poll author',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['votePoll'],
                    },
                },
            },
            {
                displayName: 'Selected Answer Indexes',
                name: 'pollSelectedAnswers',
                type: 'string',
                default: '',
                placeholder: '0,1',
                description: 'Comma-separated list of answer indexes to vote for (0-based)',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['votePoll'],
                    },
                },
            },
            // ─── Search ──────────────────────────────────────────────────────
            {
                displayName: 'Phone Numbers',
                name: 'searchNumbers',
                type: 'string',
                default: '',
                placeholder: '+1234567890,+0987654321',
                description: 'Comma-separated list of phone numbers to check',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['searchContacts'],
                    },
                },
            },
            // ─── Timeout (shared) ─────────────────────────────────────────────
            {
                displayName: 'Timeout (seconds)',
                name: 'timeout',
                type: 'number',
                default: 60,
                description: 'Request timeout in seconds (set higher for Get Groups, e.g., 300)',
                displayOptions: {
                    show: {
                        operation: TIMEOUT_OPERATIONS,
                    },
                },
                typeOptions: {
                    minValue: 1,
                    maxValue: 600,
                },
                hint: 'Increase for slow operations like Get Groups (recommended: 300 for Get Groups)',
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];
        const operation = this.getNodeParameter('operation', 0) as string;

        const credentials = await this.getCredentials('signalApi');
        const apiUrl = credentials.apiUrl as string;
        const apiToken = credentials.apiToken as string;
        const phoneNumber = credentials.phoneNumber as string;

        this.logger.debug(`Signal: Starting execute for operation ${operation}, items length: ${items.length}`);

        for (let i = 0; i < items.length; i++) {
            const timeout = (this.getNodeParameter('timeout', i, operation === 'getGroups' ? 300 : 60) as number) * 1000;
            const binaryFields = this.getNodeParameter('binaryFields', i, {}) as { binaryFieldValues?: { inputBinaryField: string }[] };
            const inputBinaryFields = binaryFields.binaryFieldValues
                ? binaryFields.binaryFieldValues
                    .map(value => value.inputBinaryField)
                    .filter(field => field.trim() !== '')
                : [];

            this.logger.debug(`Signal: Input binary fields for item ${i}: ${JSON.stringify(inputBinaryFields)}`);

            const params = {
                recipient: this.getNodeParameter('recipient', i, '') as string,
                message: this.getNodeParameter('message', i, '') as string,
                groupId: this.getNodeParameter('groupId', i, '') as string,
                groupName: this.getNodeParameter('groupName', i, '') as string,
                groupMembers: this.getNodeParameter('groupMembers', i, '') as string | string[],
                emoji: this.getNodeParameter('emoji', i, '') as string,
                targetAuthor: this.getNodeParameter('targetAuthor', i, '') as string,
                targetSentTimestamp: coerceToNumber(this.getNodeParameter('targetSentTimestamp', i, 0) as number | string) ?? 0,
                quoteMessage: this.getNodeParameter('quoteMessage', i, '') as string,
                sourceAttachmentIds: this.getNodeParameter('sourceAttachmentIds', i, '') as string | string[],
                attachmentId: this.getNodeParameter('attachmentId', i, '') as string,
                pollQuestion: this.getNodeParameter('pollQuestion', i, '') as string,
                pollAnswers: this.getNodeParameter('pollAnswers', i, '') as string | string[],
                pollAllowMultiple: this.getNodeParameter('pollAllowMultiple', i, false) as boolean,
                pollTimestamp: this.getNodeParameter('pollTimestamp', i, '') as string,
                pollAuthor: this.getNodeParameter('pollAuthor', i, '') as string,
                pollSelectedAnswers: this.getNodeParameter('pollSelectedAnswers', i, '') as string | string[],
                searchNumbers: this.getNodeParameter('searchNumbers', i, '') as string | string[],
                inputBinaryFields,
                timeout,
                apiUrl,
                apiToken,
                phoneNumber,
            };

            try {
                let result: INodeExecutionData;
                if (MESSAGE_OPERATIONS.includes(operation)) {
                    result = await executeMessagesOperation.call(this, operation, i, params);
                } else if (ATTACHMENT_OPERATIONS.includes(operation)) {
                    result = await executeAttachmentsOperation.call(this, operation, i, params);
                } else if (GROUP_OPERATIONS.includes(operation)) {
                    result = await executeGroupsOperation.call(this, operation, i, params);
                } else if (CONTACT_OPERATIONS.includes(operation)) {
                    result = await executeContactsOperation.call(this, operation, i, params);
                } else if (POLL_OPERATIONS.includes(operation)) {
                    result = await executePollsOperation.call(this, operation, i, params);
                } else if (SEARCH_OPERATIONS.includes(operation)) {
                    result = await executeSearchOperation.call(this, operation, i, params);
                } else {
                    throw new NodeApiError(this.getNode(), { message: 'Unknown operation' });
                }

                this.logger.info(`Signal: Operation ${operation} result for item ${i}: ${JSON.stringify(result.json || result.binary, null, 2)}`);
                returnData.push(result);
            } catch (error) {
                this.logger.error(`Signal: Error in operation ${operation} for item ${i}`, { error });
                throw error;
            }
        }

        this.logger.debug(`Signal: Returning data length: ${returnData.length}`);
        return [returnData];
    }
}
