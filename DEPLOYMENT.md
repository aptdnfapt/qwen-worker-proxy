# Deployment Guide

## Prerequisites

1. **Cloudflare Account** with Workers enabled
2. **Qwen OAuth Credentials** from your existing authentication
3. **Node.js** and npm installed

## Step 1: Set up Cloudflare Workers

1. Install Wrangler CLI:
   ```bash
   npm install -g wrangler
   # or use npx wrangler
   ```

2. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

## Step 2: Create KV Namespace

1. Create the KV namespace for token caching:
   ```bash
   wrangler kv namespace create "QWEN_TOKEN_CACHE"
   ```

2. Copy the template and update with your namespace ID:
   ```bash
   cp wrangler.toml.template wrangler.toml
   # Then edit wrangler.toml and replace "your-kv-namespace-id-here" with the actual ID
   ```

## Step 3: Set Environment Variables

1. Get your Qwen OAuth credentials from your existing proxy:
   ```bash
   # From your qwen-code-oai-proxy directory
   cat ~/.qwen/oauth_creds.json
   ```

2. Set the environment variable:
   ```bash
   wrangler secret put QWEN_OAUTH_CREDS
   # Paste the JSON content when prompted
   ```

3. Optional: Set API key for worker authentication:
   ```bash
   wrangler secret put OPENAI_API_KEY
   # Enter your desired API key (e.g., sk-your-secret-key)
   ```

## Step 4: Deploy

1. Install dependencies:
   ```bash
   npm install
   ```

2. Deploy to Cloudflare Workers:
   ```bash
   npm run deploy
   ```

3. Note your worker URL from the deployment output.

## Step 5: Test

1. Test the health endpoint:
   ```bash
   curl https://your-worker.workers.dev/health
   ```

2. Test the models endpoint:
   ```bash
   curl https://your-worker.workers.dev/v1/models
   ```

3. Test a chat completion:
   ```bash
   curl -X POST https://your-worker.workers.dev/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer sk-your-api-key" \
     -d '{
       "model": "qwen3-coder-plus",
       "messages": [{"role": "user", "content": "Hello!"}]
     }'
   ```

## Troubleshooting

### Common Issues

**"KV namespace not found" error:**
- Make sure you created the KV namespace and updated the ID in wrangler.toml
- The namespace ID should be a long alphanumeric string

**Authentication errors:**
- Verify your QWEN_OAUTH_CREDS JSON is valid and not expired
- Check that the refresh token is still valid
- Use the debug endpoints to check token status

**401 Unauthorized:**
- If you set OPENAI_API_KEY, make sure you're including it in requests
- If you didn't set OPENAI_API_KEY, the API should be public

### Debug Commands

```bash
# Check token cache status
curl https://your-worker.workers.dev/v1/debug/token

# Test authentication
curl https://your-worker.workers.dev/v1/debug/auth/test

# Check worker logs
wrangler tail
```

## Local Development

For local testing with the preview environment:

1. Create a preview KV namespace:
   ```bash
   wrangler kv namespace create "QWEN_TOKEN_CACHE" --preview
   ```

2. Update wrangler.toml with the preview namespace ID:
   ```toml
   kv_namespaces = [
     { binding = "QWEN_TOKEN_CACHE", id = "preview-namespace-id", preview_id = "preview-namespace-id" }
   ]
   ```

3. Run locally:
   ```bash
   npm run dev
   ```

4. Test at http://localhost:8787
