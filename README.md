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
- [Usage](#-usage)
- [Operations](#-operations)
- [Contributing](#-contributing)
- [Support the Developer](#-support-the-developer)
- [License](#-license)

## 🚀 Features

- **Send Messages**: Send text messages to individuals or groups
- **Send Media**: Send images, files, and attachments
- **Group Management**: Manage Signal groups
- **Message Reception**: Trigger workflows based on incoming messages
- **Secure Communication**: Leverages Signal's end-to-end encryption
- **REST API Integration**: Uses signal-cli-rest-api for reliable communication
- **JSON-RPC Support**: Optimized for performance with JSON-RPC mode

## 🛠 Prerequisites

Before using this n8n Signal node, you need to set up the Signal CLI REST API service:

### 1. Signal CLI REST API Setup

Create a `docker-compose.yml` file with the following configuration:

```yaml
version: '3'
services:
  signal-cli-rest-api:
    image: bbernhard/signal-cli-rest-api:latest  # Or specific version, e.g., v0.10.5
    container_name: signal-cli-rest-api
    restart: unless-stopped  # Auto-restart except manual stop
    ports:
      - "8085:8080"  # Change 8085 to available port if needed (e.g., 8003:8080)
    volumes:
      - /mnt/your-pool/signal-data:/home/.local/share/signal-cli  # Replace /mnt/your-pool with your path to signal data
      # Additionally, for config: - /mnt/your-pool/signal-config:/etc/signal-cli-rest-api (if custom settings)
    environment:
      - MODE=json-rpc  # Recommended for speed and resolves group reception issues
      - AUTHENTICATION_API_TOKEN=your-secret-token  # Optional, for basic auth (save this token for n8n credentials)
      - MAX_DB_CONNECTIONS=10  # Optimize as needed
```

### 2. Signal Account Registration

1. Start the Docker container:
   ```bash
   docker-compose up -d
   ```

2. Register your phone number:
   ```bash
   curl -X POST -H "Content-Type: application/json" \
        -d '{"number": "+1234567890"}' \
        http://localhost:8085/v1/register/+1234567890
   ```

3. Verify with the received SMS code:
   ```bash
   curl -X POST -H "Content-Type: application/json" \
        -d '{"number": "+1234567890", "captcha": "signal-hcaptcha-token"}' \
        http://localhost:8085/v1/register/+1234567890/verify/123456
   ```

4. **Alternative**: Link with existing Signal app using QR code:
   ```
   http://localhost:8085/v1/qrcodelink?device_name=n8n-signal
   ```

## 📦 Installation

### Method 1: n8n Community Package Manager

1. In your n8n instance, go to **Settings** → **Community Nodes**
2. Click **Install a community node**
3. Enter the package name: `n8n-nodes-signal-cli-rest-api`
4. Click **Install**

### Method 2: Manual Installation

1. Navigate to your n8n installation directory
2. Install the package:
   ```bash
   npm install n8n-nodes-signal-cli-rest-api
   ```
3. Restart n8n

### Method 3: Development Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/zblaze/n8n-nodes-signal.git
   cd n8n-nodes-signal
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the node:
   ```bash
   npm run build
   ```

4. Link to your n8n installation:
   ```bash
   npm link
   cd /path/to/n8n
   npm link n8n-nodes-signal
   ```

## ⚙️ Configuration

### Credentials Setup

1. In n8n, create new credentials for **Signal API**
2. Configure the following fields:
   - **API URL**: `http://localhost:8085` (or your signal-cli-rest-api URL)
   - **Phone Number**: Your registered Signal phone number (e.g., `+1234567890`)
   - **API Token**: (Optional) The authentication token you set in docker-compose
   - **Mode**: `json-rpc` (recommended for better performance)

### Node Configuration

The Signal node supports multiple operations and can be configured through the n8n interface:

- **Operation**: Choose from Send Message, Send Media, Create Group, etc.
- **Recipient**: Phone number or group ID
- **Message**: Text content to send
- **Attachments**: Files to send with the message

## 📚 Usage

### Basic Message Sending

1. Add the **Signal** node to your workflow
2. Select **Send Message** operation
3. Configure recipient and message content
4. Connect your Signal credentials
5. Execute the workflow

### Receiving Messages (Trigger)

1. Add the **Signal Trigger** node to start your workflow
2. Configure the phone number to monitor
3. Set up webhook or polling mechanism
4. Connect subsequent nodes to process incoming messages

## 🔧 Operations

### Trigger Operations
- **Receive Message**: Receive text messages from Send text messages to contacts or groups

### Send Operations
- **Send Message**: Send text messages to contacts or groups
- **Send Media**: Send images, documents, and other files
- **Send Reaction**: React to messages with emoji
- **Remove Reaction**: Remoce reaction from the message

### Group Operations  
- **Update Group**: Modify group name
- **List Groups**: Get all groups for the account

### Debug Mode

Enable debug logging in your docker-compose.yml:

```yaml
environment:
  - MODE=json-rpc
  - LOG_LEVEL=debug
  - AUTHENTICATION_API_TOKEN=your-secret-token
```

### Health Check

Test your signal-cli-rest-api setup:

```bash
# Health check
curl http://localhost:8085/v1/health

# List registered numbers  
curl http://localhost:8085/v1/accounts
```

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Add tests for new features
- Update documentation
- Follow n8n node development standards
- Ensure compatibility with latest n8n version

### Code Style

```bash
# Run linter
npm run lint

# Run tests
npm run test

# Build for production
npm run build
```

## 💖 Support the Developer

If you find this node helpful, consider supporting the developer:

[![Ko-Fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/zblaze)

[![Coinbase Commerce](https://img.shields.io/badge/Coinbase-0052FF?style=for-the-badge&logo=Coinbase&logoColor=white)](https://commerce.coinbase.com/pay/144f37a1-7d1e-468c-979d-1c8c9bcfa14b)

**Donation Links:**
- ☕ [Ko-fi](https://ko-fi.com/zblaze) - Support with coffee
- 💰 [Coinbase Commerce](https://commerce.coinbase.com/pay/144f37a1-7d1e-468c-979d-1c8c9bcfa14b) - Cryptocurrency donations

Your support helps maintain and improve this project! 🙏

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## 🔗 Related Links

- [n8n Documentation](https://docs.n8n.io/)
- [Signal CLI REST API](https://github.com/bbernhard/signal-cli-rest-api)
- [Signal Messenger](https://signal.org/)
- [n8n Community](https://community.n8n.io/)

---

<div align="center">
  <p>Made with ❤️ for the n8n community</p>
  <p>
    <a href="#-table-of-contents">Back to top</a>
  </p>
</div>
