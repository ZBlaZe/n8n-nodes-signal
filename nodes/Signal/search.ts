import { IExecuteFunctions, INodeExecutionData, NodeApiError } from 'n8n-workflow';
import axios from 'axios';
import { createAxiosConfig, handleSignalApiError, parseDelimitedList, retryRequest } from './shared';

interface OperationParams {
    searchNumbers?: string | string[];
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

    const axiosConfig = createAxiosConfig(apiToken, timeout);

    try {
        if (operation === 'searchContacts') {
            if (!searchNumbers) {
                throw new NodeApiError(this.getNode(), { message: 'At least one phone number is required for search' }, { itemIndex });
            }
            const numbers = parseDelimitedList(searchNumbers);
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
        handleSignalApiError(this, error, itemIndex);
    }
}
