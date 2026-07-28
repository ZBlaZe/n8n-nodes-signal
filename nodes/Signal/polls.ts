import { IExecuteFunctions, INodeExecutionData, NodeApiError } from 'n8n-workflow';
import axios from 'axios';
import { createAxiosConfig, handleSignalApiError, parseDelimitedList, retryRequest } from './shared';

interface OperationParams {
    recipient?: string;
    pollQuestion?: string;
    pollAnswers?: string | string[];
    pollAllowMultiple?: boolean;
    pollTimestamp?: string;
    pollAuthor?: string;
    pollSelectedAnswers?: string | string[];
    timeout: number;
    apiUrl: string;
    apiToken: string;
    phoneNumber: string;
}

export async function executePollsOperation(
    this: IExecuteFunctions,
    operation: string,
    itemIndex: number,
    params: OperationParams,
): Promise<INodeExecutionData> {
    const { recipient, pollQuestion, pollAnswers, pollAllowMultiple, pollTimestamp, pollAuthor, pollSelectedAnswers, timeout, apiUrl, apiToken, phoneNumber } = params;

    const axiosConfig = createAxiosConfig(apiToken, timeout);

    try {
        if (operation === 'createPoll') {
            if (!recipient) {
                throw new NodeApiError(this.getNode(), { message: 'Recipient is required for creating a poll' }, { itemIndex });
            }
            if (!pollQuestion) {
                throw new NodeApiError(this.getNode(), { message: 'Question is required for creating a poll' }, { itemIndex });
            }
            const answers = parseDelimitedList(pollAnswers, '\n');
            if (answers.length < 2) {
                throw new NodeApiError(this.getNode(), { message: 'At least 2 answers are required for creating a poll' }, { itemIndex });
            }
            const response = await retryRequest(() =>
                axios.post(
                    `${apiUrl}/v1/polls/${phoneNumber}`,
                    {
                        allow_multiple_selections: pollAllowMultiple ?? false,
                        answers,
                        question: pollQuestion,
                        recipient,
                    },
                    axiosConfig,
                )
            );
            return { json: response.data || { status: 'Poll created' }, pairedItem: { item: itemIndex } };
        } else if (operation === 'closePoll') {
            if (!recipient) {
                throw new NodeApiError(this.getNode(), { message: 'Recipient is required for closing a poll' }, { itemIndex });
            }
            if (!pollTimestamp) {
                throw new NodeApiError(this.getNode(), { message: 'Poll Timestamp is required for closing a poll' }, { itemIndex });
            }
            await retryRequest(() =>
                axios.delete(
                    `${apiUrl}/v1/polls/${phoneNumber}`,
                    {
                        ...axiosConfig,
                        data: {
                            poll_timestamp: pollTimestamp,
                            recipient,
                        },
                    },
                )
            );
            return { json: { status: 'Poll closed', poll_timestamp: pollTimestamp, recipient }, pairedItem: { item: itemIndex } };
        } else if (operation === 'votePoll') {
            if (!recipient) {
                throw new NodeApiError(this.getNode(), { message: 'Recipient is required for voting on a poll' }, { itemIndex });
            }
            if (!pollTimestamp) {
                throw new NodeApiError(this.getNode(), { message: 'Poll Timestamp is required for voting on a poll' }, { itemIndex });
            }
            if (!pollAuthor) {
                throw new NodeApiError(this.getNode(), { message: 'Poll Author is required for voting on a poll' }, { itemIndex });
            }
            const selectedAnswers = parseDelimitedList(pollSelectedAnswers).map(a => parseInt(a, 10)).filter(a => !isNaN(a));
            if (selectedAnswers.length === 0) {
                throw new NodeApiError(this.getNode(), { message: 'At least one answer index is required for voting on a poll' }, { itemIndex });
            }
            await retryRequest(() =>
                axios.post(
                    `${apiUrl}/v1/polls/${phoneNumber}/vote`,
                    {
                        poll_author: pollAuthor,
                        poll_timestamp: pollTimestamp,
                        recipient,
                        selected_answers: selectedAnswers,
                    },
                    axiosConfig,
                )
            );
            return { json: { status: 'Vote submitted', poll_timestamp: pollTimestamp, recipient, selected_answers: selectedAnswers }, pairedItem: { item: itemIndex } };
        }
        throw new NodeApiError(this.getNode(), { message: 'Unknown operation' });
    } catch (error) {
        handleSignalApiError(this, error, itemIndex);
    }
}
