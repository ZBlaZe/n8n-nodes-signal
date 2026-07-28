import { IExecuteFunctions, INodeExecutionData, NodeApiError } from 'n8n-workflow';
import axios from 'axios';
import { createAxiosConfig, handleSignalApiError, retryRequest } from './shared';

interface OperationParams {
    timeout: number;
    apiUrl: string;
    apiToken: string;
    phoneNumber: string;
}

export async function executeContactsOperation(
    this: IExecuteFunctions,
    operation: string,
    itemIndex: number,
    params: OperationParams,
): Promise<INodeExecutionData> {
    const { timeout, apiUrl, apiToken, phoneNumber } = params;

    const axiosConfig = createAxiosConfig(apiToken, timeout);

    try {
        if (operation === 'getContacts') {
            const response = await retryRequest(() =>
                axios.get(`${apiUrl}/v1/contacts/${phoneNumber}`, axiosConfig)
            );
            return { json: response.data, pairedItem: { item: itemIndex } };
        }
        throw new NodeApiError(this.getNode(), { message: 'Unknown operation' });
    } catch (error) {
        handleSignalApiError(this, error, itemIndex);
    }
}