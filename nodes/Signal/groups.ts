import { IExecuteFunctions, INodeExecutionData, NodeApiError } from 'n8n-workflow';
import axios from 'axios';
import { createAxiosConfig, handleSignalApiError, parseDelimitedList, retryRequest } from './shared';

interface OperationParams {
    groupName?: string;
    groupMembers?: string | string[];
    groupId?: string;
    timeout: number;
    apiUrl: string;
    apiToken: string;
    phoneNumber: string;
}

export async function executeGroupsOperation(
    this: IExecuteFunctions,
    operation: string,
    itemIndex: number,
    params: OperationParams,
): Promise<INodeExecutionData> {
    const { groupName, groupMembers, groupId, timeout, apiUrl, apiToken, phoneNumber } = params;

    const axiosConfig = createAxiosConfig(apiToken, timeout);

    try {
        if (operation === 'getGroups') {
            const response = await retryRequest(() =>
                axios.get(`${apiUrl}/v1/groups/${phoneNumber}`, axiosConfig)
            );
            return { json: response.data, pairedItem: { item: itemIndex } };
        } else if (operation === 'createGroup') {
            const members = parseDelimitedList(groupMembers);
            const response = await retryRequest(() =>
                axios.post(
                    `${apiUrl}/v1/groups/${phoneNumber}`,
                    {
                        name: groupName,
                        members,
                    },
                    axiosConfig
                )
            );
            return { json: response.data, pairedItem: { item: itemIndex } };
        } else if (operation === 'updateGroup') {
            const body: { name?: string; members?: string[] } = {};
            if (groupName) body.name = groupName;
            const members = parseDelimitedList(groupMembers);
            if (members.length > 0) body.members = members;
            const response = await retryRequest(() =>
                axios.put(
                    `${apiUrl}/v1/groups/${phoneNumber}/${groupId}`,
                    body,
                    axiosConfig
                )
            );
            return { json: response.data, pairedItem: { item: itemIndex } };
        }
        throw new NodeApiError(this.getNode(), { message: 'Unknown operation' });
    } catch (error) {
        handleSignalApiError(this, error, itemIndex);
    }
}