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
                        description: 'Update a Signal group’s name or members',
                        action: 'Update a group',
                    },
                ],
            },
            {
                displayName: 'Recipient',
                name: 'recipient',
                type: 'string',
                default: '',
                placeholder: '+1234567890 or groupId',
                description: 'Phone number or group ID to send the message, reaction, or typing indicator to',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['sendMessage', 'sendReaction', 'removeReaction', 'startTyping', 'stopTyping', 'markAsRead'],
                    },
                },
            },
            {
                displayName: 'Message',
                name: 'message',
                type: 'string',
                default: '',
                description: 'The text message to send (optional for attachments)',
                displayOptions: {
                    show: {
                        operation: ['sendMessage'],
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
                        operation: ['sendMessage'],
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
                        operation: ['createGroup', 'updateGroup'],
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
                        operation: ['createGroup', 'updateGroup'],
                    },
                },
            },
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
                placeholder: '+1234567890',
                description: 'Phone number of the message author to react to',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['sendReaction', 'removeReaction'],
                    },
                },
            },
            {
                displayName: 'Target Message Timestamp',
                name: 'targetSentTimestamp',
                type: 'number',
                default: 0,
                description: 'Timestamp of the message to react to (in milliseconds)',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['sendReaction', 'removeReaction', 'markAsRead'],
                    },
                },
            },
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
                        operation: ['downloadAttachment', 'removeAttachment'],
                    },
                },
            },
            {
                displayName: 'Timeout (seconds)',
                name: 'timeout',
                type: 'number',
                default: 60,
                description: 'Request timeout in seconds (set higher for Get Groups, e.g., 300)',
                displayOptions: {
                    show: {
                        operation: ['sendMessage', 'sendReaction', 'removeReaction', 'startTyping', 'stopTyping', 'markAsRead', 'getContacts', 'getGroups', 'createGroup', 'updateGroup', 'listAttachments', 'downloadAttachment', 'removeAttachment'],
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
                    .filter(field => field.trim() !== '') // Filter out empty fields
                : [];
            
            this.logger.debug(`Signal: Input binary fields for item ${i}: ${JSON.stringify(inputBinaryFields)}`);

            const params = {
                recipient: this.getNodeParameter('recipient', i, '') as string,
                message: this.getNodeParameter('message', i, '') as string,
                groupId: this.getNodeParameter('groupId', i, '') as string,
                groupName: this.getNodeParameter('groupName', i, '') as string,
                groupMembers: this.getNodeParameter('groupMembers', i, '') as string,
                emoji: this.getNodeParameter('emoji', i, '') as string,
                targetAuthor: this.getNodeParameter('targetAuthor', i, '') as string,
                targetSentTimestamp: this.getNodeParameter('targetSentTimestamp', i, 0) as number,
                attachmentId: this.getNodeParameter('attachmentId', i, '') as string,
                inputBinaryFields,
                timeout,
                apiUrl,
                apiToken,
                phoneNumber,
            };

            try {
                let result: INodeExecutionData;
                if (['sendMessage', 'sendReaction', 'removeReaction', 'startTyping', 'stopTyping', 'markAsRead'].includes(operation)) {
                    result = await executeMessagesOperation.call(this, operation, i, params);
                } else if (['listAttachments', 'downloadAttachment', 'removeAttachment'].includes(operation)) {
                    result = await executeAttachmentsOperation.call(this, operation, i, params);
                } else if (['getGroups', 'createGroup', 'updateGroup'].includes(operation)) {
                    result = await executeGroupsOperation.call(this, operation, i, params);
                } else if (operation === 'getContacts') {
                    result = await executeContactsOperation.call(this, operation, i, params);
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