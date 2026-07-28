import { IExecuteFunctions, NodeApiError } from 'n8n-workflow';
import { AxiosError, AxiosRequestConfig } from 'axios';

export interface SignalApiErrorResponse {
    error?: string;
}

export function createAxiosConfig(apiToken: string | undefined, timeout: number): AxiosRequestConfig {
    return {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        timeout,
    };
}

export const retryRequest = async (request: () => Promise<any>, retries = 2, delay = 5000): Promise<any> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await request();
        } catch (error) {
            if (attempt === retries) throw error;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

export function handleSignalApiError(context: IExecuteFunctions, error: unknown, itemIndex: number): never {
    const axiosError = error as AxiosError<SignalApiErrorResponse>;
    throw new NodeApiError(context.getNode(), {
        message: axiosError.message,
        description: (axiosError.response?.data?.error || axiosError.message) as string,
        httpCode: axiosError.response?.status?.toString() || 'unknown',
    }, { itemIndex });
}

// Splits a delimited string into trimmed, non-empty items (e.g. comma-separated phone numbers,
// newline-separated poll answers). Empty/whitespace-only entries are dropped.
//
// n8n resolves a field whose expression is entirely `{{ ... }}` to the expression's real type
// rather than stringifying it, so an expression like `{{ $json.attachments.map(a => a.id) }}`
// arrives here as an actual array, not "id1,id2". Accepting both keeps `.split()` from being
// called on a non-string and crashing the node.
export function parseDelimitedList(value: string | string[] | undefined, separator = ','): string[] {
    const items = Array.isArray(value) ? value : (value || '').split(separator);
    return items
        .map(item => String(item ?? '').trim())
        .filter(item => item !== '');
}

// signal-cli-rest-api is inconsistent about timestamp types across endpoints: /v2/send returns
// `timestamp` as a JSON string, but the reaction/receipt/quote endpoints require it as a JSON
// number. Chaining a Send Message response straight into a Target Message Timestamp field means
// this node receives that string as-is (n8n doesn't stringify/coerce number-typed fields either),
// and would otherwise forward it unchanged, which the API rejects with a 400. This normalizes
// either shape into a real number, falling back to `undefined` for empty/non-numeric input so
// callers can apply their own "is this required?" validation.
export function coerceToNumber(value: number | string | undefined | null): number | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(num) ? undefined : num;
}
