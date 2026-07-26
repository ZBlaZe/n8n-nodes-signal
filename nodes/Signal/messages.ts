import { IExecuteFunctions, INodeExecutionData, NodeApiError } from 'n8n-workflow';
import { AxiosError, AxiosRequestConfig } from 'axios';
import axios from 'axios';

interface SignalApiErrorResponse {
    error?: string;
}

interface OperationParams {
    recipient?: string;
    message?: string;
    emoji?: string;
    targetAuthor?: string;
    targetSentTimestamp?: number;
    quoteMessage?: string;
    sourceAttachmentIds?: string;
    inputBinaryFields?: string[];
    timeout: number;
    apiUrl: string;
    apiToken: string;
    phoneNumber: string;
}

export async function executeMessagesOperation(
    this: IExecuteFunctions,
    operation: string,
    itemIndex: number,
    params: OperationParams,
): Promise<INodeExecutionData> {
    const { recipient, message, emoji, targetAuthor, targetSentTimestamp, quoteMessage, sourceAttachmentIds, inputBinaryFields, timeout, apiUrl, apiToken, phoneNumber } = params;

    const axiosConfig: AxiosRequestConfig = {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        timeout,
    };

    const retryRequest = async (request: () => Promise<any>, retries = 2, delay = 5000): Promise<any> => {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await request();
            } catch (error) {
                if (attempt === retries) throw error;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    };

    // Converts n8n binary fields into signal-cli-rest-api's base64 data URI attachment format
    const buildBase64AttachmentsFromBinary = async (fields?: string[]): Promise<string[]> => {
        const base64Attachments: string[] = [];
        if (!fields || fields.length === 0) {
            return base64Attachments;
        }

        for (const inputBinaryField of fields) {
            if (!inputBinaryField) {
                continue;
            }

            try {
                const binaryData = this.helpers.assertBinaryData(itemIndex, inputBinaryField);
                const binaryBuffer = await this.helpers.getBinaryDataBuffer(itemIndex, inputBinaryField);

                if (!binaryBuffer || binaryBuffer.length === 0) {
                    this.logger.debug(`Signal: Binary data in field '${inputBinaryField}' is empty for item ${itemIndex}, skipping`);
                    continue;
                }

                // Check file size (Signal limit: 100MB)
                const maxFileSizeBytes = 99 * 1024 * 1024; // 99MB to be safe
                if (binaryBuffer.length > maxFileSizeBytes) {
                    throw new NodeApiError(this.getNode(), {
                        message: `File size exceeds Signal's 100MB limit (size: ${(binaryBuffer.length / (1024 * 1024)).toFixed(2)}MB). See https://support.signal.org/hc/en-us/articles/360007320391-What-kinds-of-files-can-I-send`,
                    }, { itemIndex });
                }

                // Convert binary data to base64
                const base64Data = binaryBuffer.toString('base64');
                const mimeType = binaryData.mimeType || 'application/octet-stream';
                const fileName = binaryData.fileName || `attachment_${itemIndex}_${inputBinaryField}`;

                // Use data URI format with MIME type and filename (without encoding)
                const base64Attachment = `data:${mimeType};filename=${fileName};base64,${base64Data}`;
                base64Attachments.push(base64Attachment);
                this.logger.debug(`Signal: Added base64 attachment for item ${itemIndex}, field '${inputBinaryField}': ${fileName}, MIME: ${mimeType}, Size: ${binaryBuffer.length} bytes`);
            } catch (error) {
                this.logger.debug(`Signal: No binary data for field '${inputBinaryField}' in item ${itemIndex}, skipping`);
                continue;
            }
        }

        return base64Attachments;
    };

    // Downloads an already-stored attachment (e.g. from a Signal Trigger message) and
    // re-encodes it as a base64 data URI, so it can be forwarded without a separate download step
    const fetchStoredAttachmentAsBase64 = async (attachmentId: string): Promise<string | null> => {
        try {
            const response = await retryRequest(() =>
                axios.get(`${apiUrl}/v1/attachments/${attachmentId}`, { ...axiosConfig, responseType: 'arraybuffer' })
            );

            if (!response.data || response.data.byteLength === 0) {
                this.logger.debug(`Signal: Source attachment '${attachmentId}' is empty, skipping`);
                return null;
            }

            const contentType = response.headers['content-type'] || 'application/octet-stream';
            const contentDisposition = response.headers['content-disposition'] || '';

            let fileName = '';
            const dispositionMatch = contentDisposition.match(/filename[*]?=['"]?([^'";]+)['"]?/);
            if (dispositionMatch) {
                fileName = dispositionMatch[1];
            }
            const filenameStarMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/);
            if (filenameStarMatch) {
                fileName = decodeURIComponent(filenameStarMatch[1]);
            }
            if (!fileName) {
                fileName = attachmentId;
            }

            const base64Data = Buffer.from(response.data).toString('base64');
            return `data:${contentType};filename=${fileName};base64,${base64Data}`;
        } catch (error) {
            this.logger.debug(`Signal: Failed to fetch source attachment '${attachmentId}' for forwarding, skipping`);
            return null;
        }
    };

    try {
        if (operation === 'sendMessage') {
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for sending a message',
                }, { itemIndex });
            }

            const body: { message?: string; number: string; recipients: string[]; base64_attachments?: string[] } = {
                message,
                number: phoneNumber,
                recipients: [recipient],
            };

            const base64Attachments = await buildBase64AttachmentsFromBinary(inputBinaryFields);
            if (base64Attachments.length > 0) {
                body.base64_attachments = base64Attachments;
            } else {
                this.logger.debug(`Signal: No valid attachments for item ${itemIndex}, sending text only`);
            }

            // Use /v2/send for all messages, as per user's working curl
            const endpoint = `${apiUrl}/v2/send`;
            this.logger.debug(`Signal: Sending request to ${endpoint} with body: ${JSON.stringify(body, null, 2)}`);
            const response = await retryRequest(() =>
                axios.post(endpoint, body, axiosConfig)
            );
            this.logger.debug(`Signal: Response: ${JSON.stringify(response.data, null, 2)}`);
            return { json: response.data || { status: 'Message sent' }, pairedItem: { item: itemIndex } };
        } else if (operation === 'answerMessage') {
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for answering a message',
                }, { itemIndex });
            }
            if (!targetAuthor || !targetSentTimestamp) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Target Author and Target Message Timestamp are required for answering a message',
                }, { itemIndex });
            }

            const body: {
                message?: string;
                number: string;
                recipients: string[];
                base64_attachments?: string[];
                quote_timestamp: number;
                quote_author: string;
                quote_message?: string;
            } = {
                message,
                number: phoneNumber,
                recipients: [recipient],
                quote_timestamp: targetSentTimestamp,
                quote_author: targetAuthor,
            };

            if (quoteMessage) {
                body.quote_message = quoteMessage;
            }

            const base64Attachments = await buildBase64AttachmentsFromBinary(inputBinaryFields);
            if (base64Attachments.length > 0) {
                body.base64_attachments = base64Attachments;
            }

            const endpoint = `${apiUrl}/v2/send`;
            this.logger.debug(`Signal: Sending reply to ${endpoint} with body: ${JSON.stringify(body, null, 2)}`);
            const response = await retryRequest(() =>
                axios.post(endpoint, body, axiosConfig)
            );
            return { json: response.data || { status: 'Reply sent' }, pairedItem: { item: itemIndex } };
        } else if (operation === 'forwardMessage') {
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for forwarding a message',
                }, { itemIndex });
            }

            const sourceIds = (sourceAttachmentIds || '')
                .split(',')
                .map(id => id.trim())
                .filter(id => id !== '');

            if (!message && (!inputBinaryFields || inputBinaryFields.length === 0) && sourceIds.length === 0) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Provide a message, binary attachment, or Source Attachment ID to forward',
                }, { itemIndex });
            }

            const base64Attachments = await buildBase64AttachmentsFromBinary(inputBinaryFields);

            for (const sourceId of sourceIds) {
                const attachment = await fetchStoredAttachmentAsBase64(sourceId);
                if (attachment) {
                    base64Attachments.push(attachment);
                }
            }

            const body: { message?: string; number: string; recipients: string[]; base64_attachments?: string[] } = {
                message,
                number: phoneNumber,
                recipients: [recipient],
            };
            if (base64Attachments.length > 0) {
                body.base64_attachments = base64Attachments;
            }

            const endpoint = `${apiUrl}/v2/send`;
            this.logger.debug(`Signal: Forwarding message to ${endpoint} with body: ${JSON.stringify(body, null, 2)}`);
            const response = await retryRequest(() =>
                axios.post(endpoint, body, axiosConfig)
            );
            return { json: response.data || { status: 'Message forwarded' }, pairedItem: { item: itemIndex } };
        } else if (operation === 'sendReaction') {
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for sending a reaction',
                }, { itemIndex });
            }
            const response = await retryRequest(() =>
                axios.post(
                    `${apiUrl}/v1/reactions/${phoneNumber}`,
                    {
                        reaction: emoji,
                        recipient,
                        target_author: targetAuthor,
                        timestamp: targetSentTimestamp,
                    },
                    axiosConfig
                )
            );
            return { json: response.data || { status: 'Reaction sent' }, pairedItem: { item: itemIndex } };
        } else if (operation === 'removeReaction') {
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for removing a reaction',
                }, { itemIndex });
            }
            const response = await retryRequest(() =>
                axios.delete(
                    `${apiUrl}/v1/reactions/${phoneNumber}`,
                    {
                        ...axiosConfig,
                        data: {
                            recipient,
                            target_author: targetAuthor,
                            timestamp: targetSentTimestamp,
                        },
                    }
                )
            );
            return { json: response.data || { status: 'Reaction removed' }, pairedItem: { item: itemIndex } };
        } else if (operation === 'startTyping') {
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for starting typing indicator',
                }, { itemIndex });
            }
            const response = await retryRequest(() =>
                axios.put(
                    `${apiUrl}/v1/typing-indicator/${phoneNumber}`,
                    {
                        recipient,
                        action: "start",
                    },
                    axiosConfig
                )
            );
            return { 
                json: { 
                    status: 'Typing indicator started', 
                    recipient, 
                    action: 'start',
                    timestamp: new Date().toISOString(),
                    ...response.data
                }, 
                pairedItem: { item: itemIndex } 
            };
        } else if (operation === 'stopTyping') {
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for stopping typing indicator',
                }, { itemIndex });
            }
            const response = await retryRequest(() =>
                axios.put(
                    `${apiUrl}/v1/typing-indicator/${phoneNumber}`,
                    {
                        recipient,
                        action: "stop",
                    },
                    axiosConfig
                )
            );
            return { 
                json: { 
                    status: 'Typing indicator stopped', 
                    recipient, 
                    action: 'stop',
                    timestamp: new Date().toISOString(),
                    ...response.data
                }, 
                pairedItem: { item: itemIndex } 
            };
        } else if (operation === 'markAsRead') {
            if (!recipient || !targetSentTimestamp) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient and Target Message Timestamp are required for marking as read',
                }, { itemIndex });
            }
            const response = await retryRequest(() =>
                axios.post(
                    `${apiUrl}/v1/receipts/${phoneNumber}`,
                    {
                        receipt_type: "read",
                        recipient,
                        timestamp: targetSentTimestamp
                    },
                    axiosConfig
                )
            );
            return { json: response.data || { status: 'Message marked as read' }, pairedItem: { item: itemIndex } };
        }
        throw new NodeApiError(this.getNode(), { message: 'Unknown operation' });
    } catch (error) {
        const axiosError = error as AxiosError<SignalApiErrorResponse>;
        throw new NodeApiError(this.getNode(), {
            message: axiosError.message,
            description: (axiosError.response?.data?.error || axiosError.message) as string,
            httpCode: axiosError.response?.status?.toString() || 'unknown',
        }, { itemIndex });
    }
}