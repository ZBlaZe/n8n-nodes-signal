import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class SignalApi implements ICredentialType {
    name = 'signalApi';
    displayName = 'Signal API';
    documentationUrl = 'https://github.com/bbernhard/signal-cli-rest-api';
    properties: INodeProperties[] = [
        {
            displayName: 'API URL',
            name: 'apiUrl',
            type: 'string',
            default: 'http://localhost:8080',
            placeholder: 'http://your-truenas-ip:8085',
            description: 'The URL of your signal-cli-rest-api instance',
            required: true,
        },
        {
            displayName: 'API Token',
            name: 'apiToken',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            description: 'Optional API token for authentication (set in docker-compose)',
        },
        {
            displayName: 'Phone Number',
            name: 'phoneNumber',
            type: 'string',
            default: '',
            placeholder: '+1234567890',
            description: 'Phone number registered with Signal (with country code)',
            required: true,
        },
    ];
}