import { IExecuteFunctions, INodeExecutionData, NodeApiError } from 'n8n-workflow';
import { AxiosRequestConfig } from 'axios';
import axios from 'axios';
import { createAxiosConfig, handleSignalApiError, retryRequest } from './shared';

interface OperationParams {
    attachmentId?: string;
    timeout: number;
    apiUrl: string;
    apiToken: string;
    phoneNumber: string;
}

export async function executeAttachmentsOperation(
    this: IExecuteFunctions,
    operation: string,
    itemIndex: number,
    params: OperationParams,
): Promise<INodeExecutionData> {
    const { attachmentId, timeout, apiUrl, apiToken, phoneNumber } = params;

    const axiosConfig: AxiosRequestConfig = {
        ...createAxiosConfig(apiToken, timeout),
        responseType: operation === 'downloadAttachment' ? 'arraybuffer' : 'json',
    };

    try {
        if (operation === 'listAttachments') {
            const response = await retryRequest(() =>
                axios.get(`${apiUrl}/v1/attachments/${phoneNumber}`, axiosConfig)
            );
            return { json: response.data, pairedItem: { item: itemIndex } };
        } else if (operation === 'downloadAttachment') {
            if (!attachmentId) {
                throw new NodeApiError(this.getNode(), { message: 'Attachment ID is required' });
            }
            const endpoint = `${apiUrl}/v1/attachments/${attachmentId}`;
            this.logger.debug(`Attachments: Downloading from endpoint: ${endpoint}`);
            
            const response = await retryRequest(() =>
                axios.get(endpoint, axiosConfig)
            );
            
            this.logger.debug(`Attachments: Download response size: ${response.data.byteLength}, content-type: ${response.headers['content-type']}`);
            
            if (!response.data || response.data.byteLength === 0) {
                this.logger.warn(`Attachments: Empty response data for attachment ${attachmentId}`);
                return { json: { status: 'Empty attachment' }, pairedItem: { item: itemIndex } };
            }

            const contentType = response.headers['content-type'] || 'application/octet-stream';
            const contentDisposition = response.headers['content-disposition'] || '';
            
            // Try to extract the original file name from various sources
            let fileName = '';
            
            // 1. With content-disposition header
            const dispositionMatch = contentDisposition.match(/filename[*]?=['"]?([^'";]+)['"]?/);
            if (dispositionMatch) {
                fileName = dispositionMatch[1];
            }
            
            // 2. With content-disposition (filename*)
            const filenameStarMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/);
            if (filenameStarMatch) {
                fileName = decodeURIComponent(filenameStarMatch[1]);
            }
            
            // 3. Fallback до attachmentId with fallback extension
            if (!fileName) {
                const mimeToExt: Record<string, string> = {
                    'application/pdf': 'pdf',
                    'image/jpeg': 'jpg',
                    'image/jpg': 'jpg',
                    'image/png': 'png',
                    'image/gif': 'gif',
                    'image/webp': 'webp',
                    'video/mp4': 'mp4',
                    'video/mpeg': 'mpeg',
                    'video/quicktime': 'mov',
                    'audio/mpeg': 'mp3',
                    'audio/wav': 'wav',
                    'audio/ogg': 'ogg',
                    'text/plain': 'txt',
                    'application/msword': 'doc',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
                    'application/vnd.ms-excel': 'xls',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
                    'application/zip': 'zip',
                    'application/x-rar-compressed': 'rar',
                    'application/x-7z-compressed': '7z'
                };
                
                const extension = mimeToExt[contentType] || 'bin';
                fileName = `${attachmentId}.${extension}`;
            }
            
            const fileExtension = fileName.split('.').pop() || '';
            
            // Convert ArrayBuffer into Buffer for n8n
            const buffer = Buffer.from(response.data);
            
            this.logger.debug(`Attachments: Created buffer of size: ${buffer.length}, fileName: ${fileName}`);
            
            // Define file type
            const isImage = contentType.startsWith('image/');
            const isVideo = contentType.startsWith('video/');
            const isAudio = contentType.startsWith('audio/');
            const isDocument = contentType.includes('pdf') || contentType.includes('document') || contentType.includes('text');
            
            // Format file size to human-readable string
            const formatFileSize = (bytes: number): string => {
                if (bytes === 0) return '0 Bytes';
                const k = 1024;
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
            };
            
            // Create binary data in the format n8n expects
            const binaryData = await this.helpers.prepareBinaryData(
                buffer,
                fileName,
                contentType
            );
            
            return { 
                json: { 
                    // Main info about the file
                    attachmentId,
                    fileName,
                    fileExtension,
                    mimeType: contentType,
                    
                    // File size
                    sizeBytes: buffer.length,
                    sizeFormatted: formatFileSize(buffer.length),
                    
                    // File type
                    fileType: {
                        isImage,
                        isVideo,
                        isAudio,
                        isDocument,
                        category: isImage ? 'Image' : isVideo ? 'Video' : isAudio ? 'Audio' : isDocument ? 'Document' : 'Other'
                    },
                    
                    // HTTP headers from API
                    headers: Object.keys(response.headers || {}).reduce((acc, key) => {
                        const value = response.headers[key];
                        if (value !== null && value !== undefined && value !== '') {
                            acc[key] = value;
                        }
                        return acc;
                    }, {} as Record<string, any>),
                    
                    // Additional Info
                    downloadInfo: {
                        endpoint,
                        downloadedAt: new Date().toISOString(),
                        contentDisposition: contentDisposition || null,
                        hasValidContent: buffer.length > 0,
                        isEmpty: buffer.length === 0
                    },
                    
                    // Download status
                    status: buffer.length > 0 ? 'downloaded_successfully' : 'empty_attachment'
                }, 
                binary: { 
                    data: binaryData
                }, 
                pairedItem: { item: itemIndex } 
            };
        } else if (operation === 'removeAttachment') {
            if (!attachmentId) {
                throw new NodeApiError(this.getNode(), { message: 'Attachment ID is required' });
            }
            const response = await retryRequest(() =>
                axios.delete(`${apiUrl}/v1/attachments/${attachmentId}`, axiosConfig)
            );
            return { json: response.data || { status: 'Attachment removed' }, pairedItem: { item: itemIndex } };
        }
        throw new NodeApiError(this.getNode(), { message: 'Unknown operation' });
    } catch (error) {
        handleSignalApiError(this, error, itemIndex);
    }
}