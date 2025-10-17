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
    const { recipient, message, emoji, targetAuthor, targetSentTimestamp, inputBinaryFields, timeout, apiUrl, apiToken, phoneNumber } = params;

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

            // Handle binary attachments if inputBinaryFields are specified and valid
            if (inputBinaryFields && inputBinaryFields.length > 0) {
                const binary = this.getInputData()[itemIndex].binary;
                if (!binary) {
                    this.logger.debug(`Signal: No binary data for item ${itemIndex}, skipping attachments`);
                } else {
                    const base64Attachments: string[] = [];
                    for (const inputBinaryField of inputBinaryFields) {
                        if (!inputBinaryField || !binary[inputBinaryField]) {
                            this.logger.debug(`Signal: No binary data for field '${inputBinaryField}' in item ${itemIndex}, skipping`);
                            continue;
                        }

                        const binaryData = binary[inputBinaryField];
                        // Skip if binary data is empty
                        if (!binaryData.data || binaryData.data.length === 0) {
                            this.logger.debug(`Signal: Binary data in field '${inputBinaryField}' is empty for item ${itemIndex}, skipping`);
                            continue;
                        }

                        // Check file size (Signal limit: 100MB)
                        const maxFileSizeBytes = 99 * 1024 * 1024; // 99MB to be safe
                        const binaryBuffer = Buffer.from(binaryData.data, 'base64');
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
                        this.logger.debug(`Signal: Attachment format: ${base64Attachment.substring(0, 100)}...`);
                    }

                    if (base64Attachments.length > 0) {
                        body.base64_attachments = base64Attachments;
                    } else {
                        this.logger.debug(`Signal: No valid attachments for item ${itemIndex}, sending text only`);
                    }
                }
            }

            // Use /v2/send for all messages, as per user's working curl
            const endpoint = `${apiUrl}/v2/send`;
            this.logger.debug(`Signal: Sending request to ${endpoint} with body: ${JSON.stringify(body, null, 2)}`);
            const response = await retryRequest(() =>
                axios.post(endpoint, body, axiosConfig)
            );
            this.logger.debug(`Signal: Response: ${JSON.stringify(response.data, null, 2)}`);
            return { json: response.data || { status: 'Message sent' }, pairedItem: { item: itemIndex } };
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