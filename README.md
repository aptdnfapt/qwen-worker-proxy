# Qwen Worker Proxy

OpenAI-compatible API for Qwen's models (`qwen3-coder-plus`, `qwen3-coder-flash`, `vision-model`) deployed on Cloudflare Workers with **multi-account support**.

## Overview

This project provides a Cloudflare Worker that acts as an OpenAI-compatible proxy for Qwen's AI models from free 2000 req/day of [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code). It handles OAuth2 authentication, token management, and provides standard OpenAI API endpoints.

**Multi-account support** allows you to manage multiple Qwen accounts for higher throughput and automatic failover.

## Features

- ✅ OpenAI-compatible API endpoints
- ✅ **Multi-account management** with automatic rotation
- ✅ **Automatic daily reset** of failed accounts (no cron needed!)
- ✅ **Intelligent account selection** based on token freshness
- ✅ **Automatic failover** on quota exhaustion or errors
- ✅ OAuth2 authentication with automatic token refresh
- ✅ Global edge deployment via Cloudflare Workers
- ✅ Multiple models: `qwen3-coder-plus`, `qwen3-coder-flash`, `vision-model`
- ✅ Streaming support
- ✅ Token usage tracking
- ✅ KV-based token caching
- ✅ Admin health check endpoint

## Prerequisites

1. **Cloudflare Account** with Workers enabled
2. **Qwen OAuth Credentials** from your existing authentication
3. **Node.js** and npm installed

## Quick Start (Multi-Account)

### Step 1: Set up Cloudflare Workers

1. Install dependencies:
   ```bash
   npm install
   ```

2. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

### Step 2: Add Qwen Accounts

Add one or more Qwen accounts with QR code authentication:

```bash
# Add first account
npm run auth:add account1

# Add second account
npm run auth:add account2

# Add more accounts...
npm run auth:add account3

# List all accounts
npm run auth:list
```

**What happens:**
- Shows QR code for authentication
- Auto-opens browser
- Saves credentials to `./.qwen/oauth_creds_{accountId}.json`

### Step 3: Deploy Accounts to KV

Deploy your accounts to Cloudflare KV storage:

```bash
# Deploy all accounts at once
npm run setup:deploy-all

# Or deploy individually
npm run setup:deploy account1

# List accounts in KV
npm run setup:list-kv
```

### Step 4: Set Environment Variables

**Easy way - Using .env file:**

1. Create and edit `.env` file:
   ```bash
   cp .env.example .env
   nano .env  # Edit with your values
   ```

2. Update all secrets at once:
   ```bash
   npm run secrets:update
   ```

**Manual way:**

1. Set API keys for authentication (comma-separated for multiple keys):
   ```bash
   wrangler secret put OPENAI_API_KEYS
   # Enter: sk-key1,sk-key2,sk-key3
   ```

2. Set admin secret for health check endpoint:
   ```bash
   wrangler secret put ADMIN_SECRET_KEY
   # Enter your admin secret key
   ```

**Verify secrets:**
```bash
npm run secrets:list
```

### Step 5: Deploy Worker

```bash
npm run deploy
```

Your multi-account proxy is now live! 🎉

## Testing

### Health Check
```bash
curl https://your-worker.workers.dev/health
```

### List Models
```bash
curl https://your-worker.workers.dev/v1/models
```

### Chat Completion
```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Write hello world in Python"}]
  }'
```

### Using New Models
```bash
# Using qwen3-coder-flash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-flash",
    "messages": [{"role": "user", "content": "Write hello world in Python"}]
  }'

# Using vision-model
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "vision-model",
    "messages": [{"role": "user", "content": "Describe this image if you can see it"}]
  }'
```

### With API Key Authentication
```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Explain recursion"}]
  }'
```

### Using Python OpenAI SDK
```python
from openai import OpenAI

client = OpenAI(
    base_url='https://your-worker.workers.dev/v1',
    api_key='sk-your-api-key-here'
)

# Using qwen3-coder-plus
response = client.chat.completions.create(
    model='qwen3-coder-plus',
    messages=[
        {'role': 'user', 'content': 'Explain recursion'}
    ]
)

print(response.choices[0].message.content)

# Using qwen3-coder-flash
response_flash = client.chat.completions.create(
    model='qwen3-coder-flash',
    messages=[
        {'role': 'user', 'content': 'Explain recursion'}
    ]
)

print(response_flash.choices[0].message.content)

# Using vision-model
response_vision = client.chat.completions.create(
    model='vision-model',
    messages=[
        {'role': 'user', 'content': 'Describe this image if you can see it'}
    ]
)

print(response_vision.choices[0].message.content)
```

## Local Development

See `LOCAL_DEVELOPMENT.md` for detailed local setup instructions.

## Multi-Account Management

### Account Commands

```bash
# Authentication
npm run auth:add <account-id>     # Add new account with OAuth
npm run auth:list                 # List all local accounts
npm run auth:remove <account-id>  # Remove account credentials

# Deployment
npm run setup:deploy <account-id> # Deploy single account to KV
npm run setup:deploy-all          # Deploy all accounts to KV
npm run setup:list-kv             # List accounts in KV
npm run setup:remove-kv <account-id> # Remove account from KV

# Health Check
npm run setup:health              # Check status of all accounts

# Secrets Management
npm run secrets:update            # Update all secrets from .env file
npm run secrets:list              # List all configured secrets
```

### Admin Health Check

Monitor all accounts via API endpoint:

```bash
curl https://your-worker.workers.dev/admin/health \
  -H "Authorization: Bearer your-admin-secret-key"
```

**Response:**
```json
{
  "summary": {
    "total_accounts": 5,
    "healthy_accounts": 3,
    "failed_accounts": 2,
    "quota_exceeded_accounts": 1
  },
  "accounts": [
    {
      "account": "account1",
      "status": "healthy",
      "expiresIn": "45 min"
    },
    {
      "account": "account2",
      "status": "quota_exceeded",
      "expiresIn": "12 min"
    }
  ]
}
```

### How Multi-Account Works

1. **Automatic Account Selection**: Probability-based selection favors accounts with freshest tokens
2. **Automatic Failover**: If one account fails, automatically tries another
3. **Daily Reset**: Failed accounts automatically reset at UTC midnight (lazy check, no cron needed)
4. **Manual Cleanup**: Permanently dead accounts must be removed manually via `setup:remove-kv`

### Account Lifecycle

**Quota Exhausted (429)**:
- Added to `FAILED_ACCOUNTS` list
- Auto-reset at UTC midnight
- Available again next day

**Dead Account (Invalid Token)**:
- Added to `FAILED_ACCOUNTS` list
- Auto-reset at UTC midnight
- Fails again on next use
- Admin removes with: `npm run setup:remove-kv <account-id>`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/admin/health` | GET | Multi-account health status (requires admin key) |
| `/v1/models` | GET | List available models |
| `/v1/chat/completions` | POST | Create chat completion |
| `/v1/debug/token` | GET | Token info (dev only) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEYS` | ❌ | Comma-separated API keys for authentication |
| `ADMIN_SECRET_KEY` | ❌ | Admin key for health check endpoint |
| `OPENAI_API_KEY` | ❌ | Single API key (legacy, deprecated) |

## Troubleshooting

### Common Issues

- **KV Namespace Not Found**: Ensure you've created the KV namespace and updated `wrangler.toml`
- **OAuth Credentials Invalid**: Verify your credentials are properly formatted and not expired
- **Deployment Fails**: Check Cloudflare account permissions and Wrangler authentication

### Debug Commands

For local development, see the debug tools in `LOCAL_DEVELOPMENT.md`.
