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

#### Multi-Account Setup

If you're using the multi-account system (new default), you need to deploy accounts to both local and production KV:

```bash
# Deploy accounts to LOCAL KV for development
npm run setup:deploy-all-dev

# Check local KV accounts
npm run setup:list-kv-dev

# Deploy accounts to PRODUCTION KV for live deployment  
npm run setup:deploy-all

# Check production KV accounts
npm run setup:list-kv
```

## Running Locally

### Development Server

```bash
# Make sure you have deployed accounts to local KV first
npm run setup:deploy-all-dev

# Start the development server
npm run dev
```

This starts the worker on `http://localhost:8787` with hot reloading using local KV storage.

### Testing Local Endpoints

```bash
# Health check
curl http://localhost:8787/health

# List models
curl http://localhost:8787/v1/models

# Chat completion (using multi-account system)
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 50
  }'

# Admin health check (requires ADMIN_SECRET_KEY in .dev.vars)
curl -X GET http://localhost:8787/admin/health \
  -H "Authorization: Bearer admin-secret-123"
```

## Account Management

### Local KV Management (Development)
```bash
# List accounts in local KV
npm run setup:list-kv-dev

# Deploy single account to local KV
npm run setup:deploy-dev <account-id>

# Remove account from local KV
npm run setup:remove-kv-dev <account-id>

# Health check local accounts
npm run setup:health-dev
```

### Production KV Management
```bash
# List accounts in production KV
npm run setup:list-kv

# Deploy single account to production KV
npm run setup:deploy <account-id>

# Remove account from production KV
npm run setup:remove-kv <account-id>

# Health check production accounts
npm run setup:health
```

## Authentication

### Add New Account Credentials
```bash
# Add new OAuth account
npm run auth:add your-email@example.com

# List configured accounts
npm run auth:list

# Remove account credentials
npm run auth:remove your-email@example.com
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

### Multi-Account System Not Working
```bash
# Check if accounts are deployed to local KV
npm run setup:list-kv-dev

# If no accounts found, deploy them first
npm run setup:deploy-all-dev

# Check account health
npm run setup:health-dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `QWEN_OAUTH_CREDS` | ✅ | OAuth credentials JSON string (legacy single account) |
| `OPENAI_API_KEY` | ❌ | API key for authentication (legacy) |
| `ADMIN_SECRET_KEY` | ❌ | Admin secret for health monitoring |

## Production vs Development

### Local Development Commands ✨ NEW
```bash
# Deploy accounts to local KV
npm run setup:deploy-all-dev

# Start development server
npm run dev
```

### Production Deployments
```bash
# Deploy accounts to production KV (default)
npm run setup:deploy-all

# Deploy worker to production  
npm run deploy
```

### Key Differences
- **Development**: Uses local KV namespace, runs on localhost with `-dev` commands
- **Production**: Uses production KV namespace (default), runs on Cloudflare's edge

### Quick Deployment Workflow
```bash
# Development
npm run setup:deploy-all-dev && npm run dev

# Production  
npm run setup:deploy-all && npm run deploy
```
