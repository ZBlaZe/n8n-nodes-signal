import { IExecuteFunctions, INodeExecutionData, NodeApiError } from 'n8n-workflow';
import { AxiosError, AxiosRequestConfig } from 'axios';
import axios from 'axios';

interface SignalApiErrorResponse {
    error?: string;
}

interface OperationParams {
    searchNumbers?: string;
    timeout: number;
    apiUrl: string;
    apiToken: string;
    phoneNumber: string;
}

export async function executeSearchOperation(
    this: IExecuteFunctions,
    operation: string,
    itemIndex: number,
    params: OperationParams,
): Promise<INodeExecutionData> {
    const { searchNumbers, timeout, apiUrl, apiToken, phoneNumber } = params;

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
        if (operation === 'searchContacts') {
            if (!searchNumbers) {
                throw new NodeApiError(this.getNode(), { message: 'At least one phone number is required for search' }, { itemIndex });
            }
            const numbers = searchNumbers.split(',').map(n => n.trim()).filter(n => n !== '');
            if (numbers.length === 0) {
                throw new NodeApiError(this.getNode(), { message: 'At least one valid phone number is required for search' }, { itemIndex });
            }
            const queryString = numbers.map(n => `numbers=${encodeURIComponent(n)}`).join('&');
            const response = await retryRequest(() =>
                axios.get(`${apiUrl}/v1/search/${phoneNumber}?${queryString}`, axiosConfig)
            );
            return { json: { results: response.data }, pairedItem: { item: itemIndex } };
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
