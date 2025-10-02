# Qwen Cloudflare Worker

A Cloudflare Worker that provides OpenAI-compatible API endpoints for Qwen's `qwen3-coder-plus` model via OAuth2 authentication.

## Features

- 🔐 **OAuth2 Authentication** - Device flow authentication with automatic token refresh
- 🎯 **OpenAI-Compatible API** - Drop-in replacement for OpenAI endpoints
- 📚 **OpenAI SDK Support** - Works with official OpenAI SDKs and libraries
- ⚡ **Cloudflare Workers** - Global edge deployment with low latency
- 🔄 **Smart Token Caching** - Intelligent token management with KV storage
- 🆓 **Free Tier Access** - Leverage Cloudflare's free tier
- 📡 **Real-time Streaming** - Server-sent events for live responses
- 🤖 **Single Model Focus** - Optimized for `qwen3-coder-plus`

## Supported Model

| Model ID | Description |
|----------|-------------|
| `qwen3-coder-plus` | Qwen's advanced coding model |

## Prerequisites

1. **Qwen Account** with access to qwen3-coder-plus
2. **Cloudflare Account** with Workers enabled
3. **Wrangler CLI** installed (`npm install -g wrangler`)

### Step 0: Authenticate with Cloudflare

```bash
# Login to Cloudflare
wrangler login

# Check authentication status
wrangler whoami
```

## Setup

### Step 1: Get OAuth2 Credentials

Use your existing Qwen proxy authentication:

```bash
# From your qwen-code-oai-proxy directory
npm run auth
```

Or authenticate manually and copy the credentials from `~/.qwen/oauth_creds.json`.

### Step 2: Create KV Namespace

```bash
# Create a KV namespace for token caching
wrangler kv namespace create "QWEN_TOKEN_CACHE"
```

Note the namespace ID returned and update `wrangler.toml`:
```toml
kv_namespaces = [
  { binding = "QWEN_TOKEN_CACHE", id = "your-kv-namespace-id" }
]
```

### Step 3: Environment Setup

Create a `.dev.vars` file:
```bash
# OAuth2 credentials JSON from Qwen authentication
QWEN_OAUTH_CREDS='{"access_token":"...","refresh_token":"...","scope":"...","token_type":"Bearer","id_token":"...","expiry_date":...}'

# Optional: API key for authentication (if not set, API is public)
# OPENAI_API_KEY=sk-your-secret-api-key-here
```

For production, set the secrets:
```bash
wrangler secret put QWEN_OAUTH_CREDS
wrangler secret put OPENAI_API_KEY  # Optional, only if you want authentication
```

### Step 4: Deploy

```bash
# Install dependencies
npm install

# Deploy to Cloudflare Workers
npm run deploy

# Or run locally for development
npm run dev
```

## Usage Examples

### OpenAI SDK (Python)
```python
from openai import OpenAI

# Initialize with your worker endpoint
client = OpenAI(
    base_url='https://your-worker.workers.dev/v1',
    api_key='sk-your-secret-api-key-here'  # Use your OPENAI_API_KEY if authentication is enabled
)

# Chat completion
response = client.chat.completions.create(
    model='qwen3-coder-plus',
    messages=[
        {'role': 'user', 'content': 'Write a Python function to calculate fibonacci'}
    ],
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end='')
```

### cURL
```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-secret-api-key-here" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [
      {"role": "user", "content": "Explain quantum computing"}
    ]
  }'
```

### Raw JavaScript
```javascript
const response = await fetch('https://your-worker.workers.dev/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-your-secret-api-key-here'
  },
  body: JSON.stringify({
    model: 'qwen3-coder-plus',
    messages: [
      { role: 'user', content: 'Hello, world!' }
    ]
  })
});

const result = await response.json();
console.log(result.choices[0].message.content);
```

## API Endpoints

### Base URL
```
https://your-worker.your-subdomain.workers.dev
```

### List Models
```http
GET /v1/models
```

### Chat Completions
```http
POST /v1/chat/completions
Content-Type: application/json

{
  "model": "qwen3-coder-plus",
  "messages": [
    {
      "role": "user",
      "content": "Write a sorting algorithm"
    }
  ],
  "stream": true
}
```

### Debug Endpoints

#### Token Cache Status
```http
GET /v1/debug/token
```

#### Authentication Test
```http
GET /v1/debug/auth/test
```

#### Initiate Device Flow
```http
POST /v1/debug/auth/initiate
```

#### Poll for Token
```http
POST /v1/debug/auth/poll
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `QWEN_OAUTH_CREDS` | ✅ | OAuth2 credentials JSON string |
| `OPENAI_API_KEY` | ❌ | API key for authentication. If not set, the API is public. |

### Authentication Security

- When `OPENAI_API_KEY` is set, all `/v1/*` endpoints require authentication.
- Clients must include the header: `Authorization: Bearer <your-api-key>`.
- Without this environment variable, the API is publicly accessible.
- Recommended format: `sk-` followed by a random string.

## Architecture

The worker acts as a translation layer, handling OAuth2 authentication and caching access tokens in Cloudflare KV for performance.

```
Client Request → Cloudflare Worker → Qwen API → Worker Response
```

### Token Management

- **Environment Storage**: Permanent OAuth credentials (including refresh token)
- **KV Storage**: Temporary access token caching (1-hour expiry with automatic refresh)
- **Auto-Refresh**: Seamless token renewal when access tokens expire

## Troubleshooting

### Common Issues

**401 Authentication Error**
- Check if your OAuth credentials are valid
- Ensure the refresh token is working
- Verify the credentials format matches exactly

**Token Refresh Failed**
- Credentials might be expired
- Refresh token might be revoked
- Check the debug cache endpoint for token status

### Debug Commands

```bash
# Check KV cache status
curl https://your-worker.workers.dev/v1/debug/token

# Test authentication
curl https://your-worker.workers.dev/v1/debug/auth/test

# Check worker health
curl https://your-worker.workers.dev/health
```

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to production
npm run deploy

# Check types
npm run tsc

# Lint code
npm run lint
```

## License

This project is based on the qwen-code-oai-proxy and adapted for Cloudflare Workers.
