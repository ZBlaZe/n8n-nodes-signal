# n8n Signal Node

<div align="center">
  <img src="https://logowik.com/content/uploads/images/n8nio4659.jpg" alt="n8n" width="173" height="130" />
  <img src="https://www.schmidtisblog.de/wp-content/uploads/2023/03/Signal-Logo-neu.webp" alt="Signal" width="222" height="130" />
</div>

<div align="center">
  <h3>Custom n8n node for Signal messenger integration</h3>
  <p>Send secure messages and automate Signal workflows with n8n</p>
</div>

---

## 📋 Table of Contents

- [Features](#-features)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Operations](#-operations)
- [Contributing](#-contributing)
- [Support the Developer](#-support-the-developer)
- [License](#-license)

## 🚀 Features

- **Send Messages**: Send text messages to individuals or groups
- **Send Media**: Send images, files, and attachments
- **Reply to Messages**: Answer a specific message with a quote reference
- **Forward Messages**: Forward a message, including its attachments, to another contact or group
- **Reactions**: React to messages or remove reactions
- **Typing Indicators**: Show/hide typing status
- **Read Receipts**: Mark messages as read
- **Polls**: Create, close, and vote on Signal polls
- **Search**: Check if phone numbers are registered with Signal
- **Group Management**: Create, update, and list Signal groups
- **Contact Management**: List contacts for the account
- **Attachment Handling**: List, download, and remove attachments
- **Message Reception**: Trigger workflows on incoming messages via WebSocket
- **Secure Communication**: Leverages Signal's end-to-end encryption
- **REST API Integration**: Uses signal-cli-rest-api for reliable communication

## 🛠 Prerequisites

Before using this n8n Signal node, you need to set up the Signal CLI REST API service:

### 1. Signal CLI REST API Setup

Create a `docker-compose.yml` file with the following configuration:

```yaml
version: '3'
services:
  signal-cli-rest-api:
    image: bbernhard/signal-cli-rest-api:latest
    container_name: signal-cli-rest-api
    restart: unless-stopped
    ports:
      - "8085:8080"
    volumes:
      - /mnt/your-pool/signal-data:/home/.local/share/signal-cli
    environment:
      - MODE=json-rpc  # Recommended for speed and group reception
      - AUTHENTICATION_API_TOKEN=your-secret-token  # Optional
```

### 2. Signal Account Registration

1. Start the Docker container:
   ```bash
   docker-compose up -d
   ```

2. Link with existing Signal app using QR code:
   ```
   http://localhost:8085/v1/qrcodelink?device_name=n8n-signal
   ```

3. Or register a new number:
   ```bash
   curl -X POST 'http://localhost:8085/v1/register/+1234567890'
   ```

## 📦 Installation

### Method 1: n8n Community Package Manager

1. In your n8n instance, go to **Settings** → **Community Nodes**
2. Click **Install a community node**
3. Enter the package name: `n8n-nodes-signal-cli-rest-api`
4. Click **Install**

### Method 2: Manual Installation

```bash
npm install n8n-nodes-signal-cli-rest-api
```

### Method 3: Development Setup

```bash
git clone https://github.com/zblaze/n8n-nodes-signal.git
cd n8n-nodes-signal
npm install
npm run build
```

## ⚙️ Configuration

### Credentials Setup

In n8n, create new credentials for **Signal API** and configure:

| Field | Description | Example |
|-------|-------------|---------|
| **API URL** | URL of your signal-cli-rest-api instance | `http://localhost:8085` |
| **Phone Number** | Registered Signal phone number | `+1234567890` |
| **API Token** | Optional Bearer token for authentication | `your-secret-token` |

## 🔧 Operations

### Messages

| Operation | Description |
|-----------|-------------|
| **Send Message** | Send a text message to a contact or group, optionally with file attachments |
| **Send Reaction** | React to a message with an emoji |
| **Remove Reaction** | Remove a previously sent reaction |
| **Start Typing** | Show typing indicator to a recipient |
| **Stop Typing** | Stop showing typing indicator |
| **Mark As Read** | Send a read receipt for a message |
| **Answer Message** | Reply to a specific message with a quote reference |
| **Forward Message** | Forward a message, including its attachments, to another contact or group |

#### Send Message — parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| Recipient | ✅ | Phone number or group ID |
| Message | | Text content (optional if sending attachments) |
| Binary Fields | | One or more binary fields containing files to attach |
| Timeout | | Request timeout in seconds (default: 60) |

#### Send Reaction — parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| Recipient | ✅ | Phone number or group ID |
| Emoji | ✅ | Reaction emoji (predefined list or custom) |
| Target Author | ✅ | Phone number of the original message author |
| Target Message Timestamp | ✅ | Timestamp of the message to react to (ms) |

#### Answer Message — parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| Recipient | ✅ | Phone number or group ID to send the reply to |
| Message | | Reply text (optional if sending attachments) |
| Target Author | ✅ | Phone number of the original message's author |
| Target Message Timestamp | ✅ | Timestamp of the message being replied to (ms) |
| Quoted Message Text | | Text snippet of the original message shown in the quote preview |
| Binary Fields | | One or more binary fields containing files to attach |
| Timeout | | Request timeout in seconds (default: 60) |

> Uses signal-cli-rest-api's `quote_timestamp` / `quote_author` / `quote_message` fields on `/v2/send` — there's no dedicated "reply" endpoint, so this composes a regular send with a quote reference.

#### Forward Message — parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| Recipient | ✅ | Phone number or group ID to forward the message to |
| Message | | Text content to forward (e.g. the original `messageText` from the trigger) |
| Source Attachment IDs | | Comma-separated attachment IDs from the original message (from the trigger's `attachments` field) — fetched from the server and re-sent automatically |
| Binary Fields | | Additional binary fields to attach (e.g. files you already downloaded yourself) |
| Timeout | | Request timeout in seconds (default: 60) |

> The underlying API has no native "forward" call, so this re-sends the text and attachments as a new message to the chosen recipient. It won't carry Signal's built-in "Forwarded" badge, since that's not exposed by signal-cli-rest-api.

---

### Attachments

| Operation | Description |
|-----------|-------------|
| **List Attachments** | List all stored attachments for the account |
| **Download Attachment** | Download an attachment as a binary file |
| **Remove Attachment** | Delete an attachment from the server |

---

### Contacts

| Operation | Description |
|-----------|-------------|
| **Get Contacts** | Retrieve the full contact list for the account |

---

### Groups

| Operation | Description |
|-----------|-------------|
| **Get Groups** | Retrieve all groups for the account (may be slow — use timeout 300s) |
| **Create Group** | Create a new Signal group with a name and initial members |
| **Update Group** | Update a group's name or member list |

#### Create / Update Group — parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| Group ID | ✅ (update only) | ID of the group to update |
| Group Name | | New name for the group |
| Group Members | | Comma-separated phone numbers |

---

### Polls

Signal polls let you send a question with multiple-choice answers to a contact or group.

| Operation | Description |
|-----------|-------------|
| **Create Poll** | Send a new poll to a contact or group |
| **Close Poll** | Close an existing poll so no more votes can be submitted |
| **Vote on Poll** | Submit a vote on a poll |

#### Create Poll — parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| Recipient | ✅ | Phone number, username, or group ID |
| Question | ✅ | The poll question |
| Answers | ✅ | One answer per line (minimum 2) |
| Allow Multiple Selections | | Whether voters can select more than one answer (default: false) |

> **Response** includes a `timestamp` field — save it, you'll need it to close the poll or submit votes.

#### Close Poll — parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| Recipient | ✅ | Same recipient the poll was sent to |
| Poll Timestamp | ✅ | Timestamp returned when the poll was created |

#### Vote on Poll — parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| Recipient | ✅ | Same recipient the poll was sent to |
| Poll Timestamp | ✅ | Timestamp returned when the poll was created |
| Poll Author | ✅ | Phone number or UUID of the poll creator |
| Selected Answer Indexes | ✅ | Comma-separated 0-based indexes (e.g. `0,2`) |

---

### Search

| Operation | Description |
|-----------|-------------|
| **Check Registration** | Check if one or more phone numbers are registered with Signal |

#### Check Registration — parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| Phone Numbers | ✅ | Comma-separated list of numbers to check |

**Response example:**
```json
{
  "results": [
    { "number": "+1234567890", "registered": true },
    { "number": "+0987654321", "registered": false }
  ]
}
```

---

### Signal Trigger

The **Signal Trigger** node starts a workflow when a new message arrives via WebSocket.

| Parameter | Description |
|-----------|-------------|
| Reconnect Delay | Seconds to wait before reconnecting on disconnect |
| Ignore Messages | Skip messages with text content |
| Ignore Attachments | Skip messages with attachments |
| Ignore Reactions | Skip messages with reactions |

**Output fields:**

| Field | Description |
|-------|-------------|
| `messageText` | Text content of the message |
| `attachments` | List of received attachments |
| `reactions` | Reaction data if present |
| `sourceName` | Display name of the sender |
| `sourceUuid` | UUID of the sender |
| `groupInternalId` | Group ID (if message was in a group) |
| `groupName` | Group name (if message was in a group) |
| `timestamp` | Message timestamp (use for reactions, read receipts, polls) |
| `messageType` | `incoming` or `outgoing` |
| `envelope` | Full raw envelope from Signal |

> **Tip:** The `timestamp` from the trigger output is what you pass as **Target Message Timestamp**, **Poll Timestamp**, etc. in subsequent nodes. For **Forward Message**, the `id` of each entry in `attachments` is what you pass as **Source Attachment IDs**.

---

## 🐞 Troubleshooting

### "Specified account does not exist"
Verify your registered account via:
```bash
curl http://<host>:<port>/v1/accounts
```
Compare the returned number character-by-character against the **Phone Number** in your n8n credentials — a typo is the most common cause.

### Get Groups is slow or times out
Set **Timeout** to `300` seconds for the Get Groups operation.

### Attachments not downloading
Check that the attachment ID is correct (use the value from the trigger's `attachments` field).

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 💖 Support the Developer

[![Ko-Fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/zblaze)
[![Coinbase Commerce](https://img.shields.io/badge/Coinbase-0052FF?style=for-the-badge&logo=Coinbase&logoColor=white)](https://commerce.coinbase.com/pay/144f37a1-7d1e-468c-979d-1c8c9bcfa14b)

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

## 🔗 Related Links

- [n8n Documentation](https://docs.n8n.io/)
- [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api)
- [Signal Messenger](https://signal.org/)
- [n8n Community](https://community.n8n.io/)

---

<div align="center">
  <p>Made with ❤️ for the n8n community</p>
</div>
