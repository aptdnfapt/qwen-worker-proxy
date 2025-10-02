# Qwen Worker Proxy

OpenAI-compatible API for Qwen's `qwen3-coder-plus` model deployed on Cloudflare Workers.

## Overview

This project provides a Cloudflare Worker that acts as an OpenAI-compatible proxy for Qwen's AI models form free 2000 req/day of  [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code). It handles OAuth2 authentication, token management, and provides standard OpenAI API endpoints.

## Features

- ✅ OpenAI-compatible API endpoints
- ✅ OAuth2 authentication with automatic token refresh
- ✅ Global edge deployment via Cloudflare Workers
- ✅ Single model: `qwen3-coder-plus`
- ✅ Streaming support
- ✅ Token usage tracking
- ✅ KV-based token caching

## Prerequisites

1. **Cloudflare Account** with Workers enabled
2. **Qwen OAuth Credentials** from your existing authentication
3. **Node.js** and npm installed

## Deployment Guide

### Step 1: Set up Cloudflare Workers

1. Install Wrangler CLI:
   ```bash
   npm install -g wrangler
   # or use npx wrangler
   ```

2. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

### Step 2: Create KV Namespace

1. Create the KV namespace for token caching:
   ```bash
   wrangler kv namespace create "QWEN_TOKEN_CACHE"
   ```

2. Copy the template and update with your namespace ID:
   ```bash
   cp wrangler.toml.template wrangler.toml
   # Then edit wrangler.toml and replace "your-kv-namespace-id-here" with the actual ID
   ```

### Step 3: Get OAuth Credentials

1. Get your Qwen OAuth credentials by logging into the Qwen CLI: [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code)
2. After successful authentication, your credentials file will be automatically created. Copy them from:
   ```bash
   cat ~/.qwen/oauth_creds.json
   ```

### Step 4: Set Environment Variables

1. Set the OAuth credentials as a secret:
   ```bash
   wrangler secret put QWEN_OAUTH_CREDS
   # Paste the JSON content when prompted
   ```

2. Optional: Set API key for worker authentication: ( recommended as endpoints will be public )
   ```bash
   wrangler secret put OPENAI_API_KEY
   # Enter your desired API key (e.g., sk-your-secret-key)
   ```

### Step 5: Deploy

1. Install dependencies:
   ```bash
   npm install
   ```

2. Deploy to Cloudflare Workers:
   ```bash
   npm run deploy
   ```

3. Note your worker URL from the deployment output.

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

## Local Development

See `LOCAL_DEVELOPMENT.md` for detailed local setup instructions.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/models` | GET | List available models |
| `/v1/chat/completions` | POST | Create chat completion |
| `/v1/debug/token` | GET | Token cache status (dev only) |
| `/v1/debug/auth/test` | GET | Authentication test (dev only) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `QWEN_OAUTH_CREDS` | ✅ | OAuth credentials JSON string |
| `OPENAI_API_KEY` | ❌ | API key for authentication |

## Troubleshooting

### Common Issues

- **KV Namespace Not Found**: Ensure you've created the KV namespace and updated `wrangler.toml`
- **OAuth Credentials Invalid**: Verify your credentials are properly formatted and not expired
- **Deployment Fails**: Check Cloudflare account permissions and Wrangler authentication

### Debug Commands

For local development, see the debug tools in `LOCAL_DEVELOPMENT.md`.
