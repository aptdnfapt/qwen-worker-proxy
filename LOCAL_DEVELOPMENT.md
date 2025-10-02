# Local Development Guide

This guide covers setting up and running the qwen-worker locally for development and testing.

## Prerequisites

1. **Node.js** (v18+)
2. **Wrangler CLI** - `npm install -g wrangler`
3. **Cloudflare Account** - `wrangler login`

## Setup

### 1. Install Dependencies

```bash
cd qwen-worker
npm install
```

### 2. Get OAuth Credentials

**Option A: Use qwen-code-oai-proxy (Recommended)**
```bash
git clone https://github.com/your-org/qwen-code-oai-proxy
cd qwen-code-oai-proxy
npm install
npm run auth:add <your-account-name>
```

**Option B: Use official qwen-code CLI**
```bash
git clone https://github.com/QwenLM/qwen-code
cd qwen-code
npm install
npm run auth
```

Then copy credentials from `~/.qwen/oauth_creds.json`.

### 3. Create Local Environment File

```bash
# Copy the example file
cp .dev.vars.example .dev.vars

# Edit .dev.vars with your actual credentials
nano .dev.vars
```

Your `.dev.vars` should contain:
```bash
QWEN_OAUTH_CREDS='{"access_token":"your-access-token","refresh_token":"your-refresh-token","token_type":"Bearer","resource_url":"portal.qwen.ai","expiry_date":1234567890123}'
# OPENAI_API_KEY=sk-your-api-key-here  # Optional
```

### 4. KV Setup

First create your wrangler.toml from the template and set up your KV namespace:

```bash
# Copy the template (only need to do this once)
cp wrangler.toml.template wrangler.toml

# Create your own KV namespace
wrangler kv namespace create "QWEN_TOKEN_CACHE"

# Update wrangler.toml with your returned ID
```

## Running Locally

### Development Server

```bash
npm run dev
```

This starts the worker on `http://localhost:8787` with hot reloading.

### Testing Local Endpoints

```bash
# Health check
curl http://localhost:8787/health

# List models
curl http://localhost:8787/v1/models

# Chat completion (without auth)
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Chat completion (with auth if OPENAI_API_KEY is set)
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Write hello world"}]
  }'
```

## Debug Tools

### Token Cache Status
```bash
curl http://localhost:8787/v1/debug/token
```

### Authentication Test
```bash
curl http://localhost:8787/v1/debug/auth/test
```

### Manual OAuth Flow
```bash
# Initiate device flow
curl -X POST http://localhost:8787/v1/debug/auth/initiate \
  -H "Content-Type: application/json" \
  -d '{}'

# Poll for token (use device_code from previous response)
curl -X POST http://localhost:8787/v1/debug/auth/poll \
  -H "Content-Type: application/json" \
  -d '{"device_code":"your-device-code"}'
```

## Common Issues

### KV Namespace Not Found
```bash
# Did you create your own KV namespace?
wrangler kv namespace create "QWEN_TOKEN_CACHE"

# Did you copy the template?
cp wrangler.toml.template wrangler.toml

# Did you update the ID in wrangler.toml?
```

### OAuth Credentials Invalid
Double-check that your `QWEN_OAUTH_CREDS` JSON is properly escaped in `.dev.vars`.

### Port Already in Use
Kill any existing processes on port 8787 or use a different port:
```bash
lsof -ti:8787 | xargs kill -9
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `QWEN_OAUTH_CREDS` | ✅ | OAuth credentials JSON string |
| `OPENAI_API_KEY` | ❌ | API key for authentication |

## Production vs Development

- **Development**: Uses local KV namespace, runs on localhost
- **Production**: Uses production KV namespace, runs on Cloudflare's edge

To deploy to production:
```bash
npm run deploy
```
