# Multi-Account Qwen Worker Proxy Implementation Plan

## Overview
Transform the current single-account worker proxy into a robust multi-account system using the exact same workflow as the qwen-code-oai-proxy reference project.

## Current State Analysis
- **Current KV namespace ID**: `e3f8b0591a9d4525ac871675632588d9` (already exists in wrangler.toml)
- **Current auth**: Single account via `QWEN_OAUTH_CREDS` environment variable
- **Current worker**: Basic OAuth2 with token caching in KV
- **Reference project**: Has multi-account support with queue-based rotation

## Features to Implement Checklist

### ✅ Authentication Management
- [ ] `npm run auth:add <account>` - Add new account with QR code authentication
- [ ] `npm run auth:list` - List all accounts in `./.qwen/` directory  
- [ ] `npm run auth:remove <account>` - Remove account file from `./.qwen/`
- [ ] Stores credentials in `./.qwen/oauth_creds_{account}.json`

### ✅ Multi-Account Deployment
- [ ] `npm run setup:deploy <account>` - Deploy single account to KV storage
- [ ] `npm run setup:deploy-all` - Deploy ALL accounts from `./.qwen/` to KV
- [ ] `npm run setup:list-kv` - List accounts currently in KV
- [ ] `npm run setup:remove-kv <account>` - Remove account from KV
- [ ] Uses existing KV namespace: `e3f8b0591a9d4525ac871675632588d9`

### ✅ Account Rotation & Failure Management
- [ ] **Probability-based selection** - Weighted random based on token expiry time
- [ ] **Type 1: Token Expired (401)** - Auto-refresh using refresh token + retry same account
- [ ] **Type 2: Quota Exceeded (429)** - Add to FAILED_ACCOUNTS + try different account once
- [ ] **Type 3: Server Errors (500/502/504)** - Try different account once (NO KV write)
- [ ] **Type 4: Other Errors** - Try different account once, then return error
- [ ] **Max retries**: 1 attempt, then give up (avoid burning Cloudflare limits)
- [ ] **Manual cleanup** - Admin removes failed accounts via dashboard or CLI 



## Phase 1: File Structure & Authentication (Copy from oai-proxy)

### Project Structure
```
./
├── .qwen/
│   ├── oauth_creds_myacc1.json    # Stored in PROJECT directory (not ~/.qwen/)
│   ├── oauth_creds_myacc2.json    # Each account has separate file
│   └── oauth_creds_myacc3.json
├── authenticate.js                # NEW - Copied from oai-proxy
├── setup-accounts.js              # NEW - Handles deployment to KV
├── package.json                   # Add new scripts
└── src/
    └── [existing worker code]
```

### OAuth Process (Exactly like oai-proxy)
```bash
npm run auth:add myacc1
```
**What happens:**
- Shows QR code + verification URL (same as oai-proxy)
- Auto-opens browser for authentication
- **Stores credentials in `./.qwen/oauth_creds_myacc1.json`**
- Uses same PKCE flow, same endpoints, same everything

## Phase 2: KV Storage Architecture

### KV Data Structure (Minimal - No Locks!)
```
KEY                     VALUE                                    PURPOSE
ACCOUNT:myacc1         {access_token, refresh_token, expiry_date} Permanent storage
ACCOUNT:myacc2         {access_token, refresh_token, expiry_date} Permanent storage
ACCOUNT:myacc3         {access_token, refresh_token, expiry_date} Permanent storage
FAILED_ACCOUNTS        "myacc5,myacc8"                            Temporary failed list (manual cleanup)
```

**Total KV Pairs:** 1 per account + 1 for failed list

### Account Selection Logic (Probability-Based with Proactive Refresh)

**No locks, no index, no automatic resets!**

**Enhanced Selection Algorithm:**
```javascript
// 1. Get all accounts
const allAccounts = ["myacc1", "myacc2", "myacc3"];
const failed = (await KV.get("FAILED_ACCOUNTS") || "").split(",").filter(Boolean);

// 2. Filter out failed accounts
const available = allAccounts.filter(a => !failed.includes(a));

// 3. Load credentials and find freshest account
const accountsWithCreds = [];
let freshestMinutes = -Infinity;

for (const accountId of available) {
  const creds = await KV.get(`ACCOUNT:${accountId}`);
  const minutesLeft = (creds.expiry_date - Date.now()) / 60000;
  
  if (minutesLeft > freshestMinutes) {
    freshestMinutes = minutesLeft;
  }
  
  accountsWithCreds.push({ accountId, creds, minutesLeft });
}

// 4. Calculate probability based on freshness
const weighted = [];
for (const account of accountsWithCreds) {
  let probability;
  
  // Expired: 10% chance to trigger proactive refresh
  if (account.minutesLeft < 0) {
    probability = 0.1;
  }
  // Freshest: 85% probability
  else if (account.minutesLeft === freshestMinutes) {
    probability = 0.85;
  }
  // Others: Based on time left
  else if (account.minutesLeft > 30) probability = 0.7;
  else if (account.minutesLeft > 20) probability = 0.5;
  else if (account.minutesLeft > 10) probability = 0.3;
  else if (account.minutesLeft > 5) probability = 0.1;
  else probability = 0.05;
  
  weighted.push({ ...account, probability });
}

// 5. Weighted random selection
const selected = weightedRandomSelect(weighted);

// 6. Handle expired account with proactive refresh
if (selected.minutesLeft < 0) {
  try {
    console.log(`Proactive refresh for ${selected.accountId}...`);
    await refreshToken(selected.accountId, selected.creds.refresh_token);
    selected.creds = await KV.get(`ACCOUNT:${selected.accountId}`);
  } catch (refreshError) {
    console.log(`Refresh failed, fallback to freshest account`);
    // Find freshest account and use it
    const freshest = weighted.find(a => a.minutesLeft === freshestMinutes);
    return freshest;
  }
}

return selected;
```

**Why This Works:**
- **Fresh tokens (>30 min)**: 85% probability → most requests use freshest ✅ No conflicts
- **Expired tokens**: 10% probability → triggers proactive refresh before all tokens expire
- **Refresh failure**: Automatic fallback to freshest account
- **No mass expiry**: Tokens get refreshed gradually over time
- **Natural distribution**: No locks needed, probability handles parallelism

**Proactive Refresh Benefits:**
- Prevents all tokens from expiring simultaneously
- 10% of requests act as "maintenance workers" refreshing tokens
- If refresh fails, request still succeeds (fallback to freshest)
- Expired accounts not marked as dead (only quota errors are)

### Error Handling & Retry Logic

**Type 1: Token Expired (401)**
```javascript
// Auto-refresh with refresh token
await refreshToken(accountId); // Writes to KV: ACCOUNT:accountId
retrySameAccount();
```
- **KV Write**: Updates `ACCOUNT:accountId` with new token
- **Account Status**: ✅ Still valid

**Type 2: Quota Exceeded (429)**
```javascript
// Mark as failed and try different account
const failed = await KV.get("FAILED_ACCOUNTS") || "";
await KV.put("FAILED_ACCOUNTS", `${failed},${accountId}`); // Write to KV
tryDifferentAccount(); // Retry once with different account
```
- **KV Write**: Adds to `FAILED_ACCOUNTS` list
- **Account Status**: ❌ Temporarily dead (manual cleanup needed)
- **Max Retries**: 1 attempt with different account

**Type 3: Server Errors (500/502/504)**
```javascript
// Just try different account, NO KV write
tryDifferentAccount(); // Retry once
```
- **KV Write**: None
- **Account Status**: ✅ Still valid
- **Max Retries**: 1 attempt with different account

**Type 4: Other Errors**
```javascript
// Try different account once, then give up
tryDifferentAccount(); // Retry once
if (stillFails) {
  return errorToUser(); // Don't burn Cloudflare request limits
}
```

### Failed Account Management

**Two types of failures:**

**Type A: Quota Exceeded (429) - Temporary**
- Added to `FAILED_ACCOUNTS` list automatically
- **Reset manually at UTC midnight** by clearing `FAILED_ACCOUNTS` list
- Account still exists in KV with valid credentials
- **Daily manual reset**: Admin clears `FAILED_ACCOUNTS` via Cloudflare dashboard or CLI

**Type B: Invalid Credentials - Permanent**
- Refresh token expired or invalid
- **Must remove from KV**: `npm run setup:remove-kv myacc5`
- Account is dead and cannot be recovered

**Daily Reset Process (Manual):**
```bash
# Option 1: Via Cloudflare dashboard
# Go to KV namespace → Edit FAILED_ACCOUNTS → Set to ""

# Option 2: Via wrangler CLI
wrangler kv key put "FAILED_ACCOUNTS" "" --namespace-id="e3f8b0591a9d4525ac871675632588d9"

# Option 3: Use health check to identify which accounts are 429 vs dead
npm run setup:health
```

### Storage Analysis
- **50 accounts**: ~40KB storage (51 KV pairs total)
- **KV Writes per day**: 
  - Token refreshes: ~24 per actively used account
  - Quota failures: ~5-10 per day
  - **Total**: ~120-240 writes/day for 5-10 active accounts ✅ Well within 1,000 limit
- **Cost**: $0 (free tier)

## Phase 3: Setup & Management Commands

### Authentication Commands (Same as oai-proxy)
```bash
npm run auth:add myacc1        # Add new account with OAuth flow
npm run auth:list             # List all accounts in ./.qwen/
npm run auth:remove myacc1    # Remove account file from ./.qwen/
```

### Deployment Commands (NEW - Copy to KV)
```bash
npm run setup:deploy myacc1    # Deploy single account to KV
npm run setup:deploy-all      # Deploy ALL accounts from ./.qwen/ to KV
npm run setup:list-kv         # List accounts currently in KV
npm run setup:remove-kv myacc1 # Remove account from KV
```

## Phase 4: Implementation Details

### authenticate.js (Copy from oai-proxy)
- **Same OAuth flow**: device code, QR code, browser auto-open
- **Same PKCE implementation**: code verifier/challenge generation
- **Same file storage**: `./.qwen/oauth_creds_{accountId}.json`
- **Only change**: Store in project directory instead of home directory

### setup-accounts.js (NEW - KV Deployment)
```javascript
// Uses built-in Node.js modules only
const fs = require('fs');
const { execSync } = require('child_process');
const toml = require('toml'); // Need to add: npm install toml

// Read KV namespace ID from wrangler.toml
function getKvNamespaceId() {
  const wranglerConfig = fs.readFileSync('./wrangler.toml', 'utf8');
  const config = toml.parse(wranglerConfig);
  return config.kv_namespaces[0].id; // e3f8b0591a9d4525ac871675632588d9
}

function deployAccount(accountId) {
  const credsPath = `./.qwen/oauth_creds_${accountId}.json`;
  const credentials = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
  const kvNamespaceId = getKvNamespaceId();
  
  // Use wrangler CLI to store in KV
  execSync(`wrangler kv key put "ACCOUNT:${accountId}" '${JSON.stringify(credentials)}' --namespace-id="${kvNamespaceId}"`);
  
  console.log(`✅ Deployed ${accountId} to KV`);
}
```

**What `setup:deploy` actually does:**
```bash
npm run setup:deploy myacc1
# → Executes: wrangler kv key put "ACCOUNT:myacc1" '{"access_token":"...","refresh_token":"..."}' --namespace-id="e3f8b0591a9d4525ac871675632588d9"
```

**KV namespace ID source:**
- **Already exists**: `e3f8b0591a9d4525ac871675632588d9` (from your current wrangler.toml)
- **setup-accounts.js reads it automatically** from wrangler.toml using toml parser
- **No manual setup needed** - use existing namespace

**Dependencies needed:**
```bash
npm install toml  # For parsing wrangler.toml
```

**setup-accounts.js functions needed:**
```javascript
// Complete implementation skeleton
async function deployAccount(accountId) { /* as above */ }
async function deployAllAccounts() { /* deploy all .qwen/*.json files */ }
async function listKvAccounts() { /* list ACCOUNT:* keys in KV */ }
async function removeKvAccount(accountId) { /* delete ACCOUNT:accountId from KV */ }
```

### Worker Changes (Modify existing code)
- **QwenAuthManager**: Load accounts from KV instead of environment variable
- **Account Selection**: Atomic locking mechanism using KV
- **Failover Logic**: Try different accounts on quota/auth errors
- **Parallel Processing**: True concurrent account usage

## Phase 5: Package.json Scripts

### Add to package.json
```json
{
  "scripts": {
    "auth:add": "node authenticate.js add",
    "auth:list": "node authenticate.js list", 
    "auth:remove": "node authenticate.js remove",
    "setup:deploy": "node setup-accounts.js deploy",
    "setup:deploy-all": "node setup-accounts.js deploy-all",
    "setup:list-kv": "node setup-accounts.js list-kv",
    "setup:remove-kv": "node setup-accounts.js remove-kv",
    "setup:health": "node setup-accounts.js health"
  },
  "dependencies": {
    "hono": "^4.9.2",
    "toml": "^3.0.0"
  }
}
```

### Dependencies to Install
```bash
npm install toml  # For parsing wrangler.toml in setup-accounts.js
```

### Additional Management Commands
```bash
npm run setup:health           # Check status of all accounts (makes test API calls)
```

## Phase 6: Multi-Account Worker Logic & Health Check

### Admin Health Check Endpoint
```javascript
// GET /admin/health
// Authorization: Bearer ADMIN_SECRET_KEY
// Single request tests ALL accounts with auto-refresh

async function healthCheck(env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.ADMIN_SECRET_KEY}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const allAccounts = await getAllAccountIds();
  const results = [];
  
  for (const accountId of allAccounts) {
    let creds = await env.QWEN_TOKEN_CACHE.get(`ACCOUNT:${accountId}`);
    
    // Auto-refresh if expired
    if (creds.expiry_date < Date.now()) {
      try {
        await refreshToken(accountId, creds.refresh_token);
        creds = await env.QWEN_TOKEN_CACHE.get(`ACCOUNT:${accountId}`);
      } catch (refreshError) {
        results.push({
          account: accountId,
          status: "refresh_failed",
          error: refreshError.message,
          expiresIn: "expired"
        });
        continue;
      }
    }
    
    // Make test API call
    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/models", {
      headers: { Authorization: `Bearer ${creds.access_token}` }
    });
    
    results.push({
      account: accountId,
      status: response.status,
      error: response.ok ? null : await response.text(),
      expiresIn: Math.floor((creds.expiry_date - Date.now()) / 60000) + " min"
    });
  }
  
  return Response.json(results);
}
```

**Expected Output:**
```json
[
  {
    "account": "myacc1",
    "status": 200,
    "error": null,
    "expiresIn": "45 min"
  },
  {
    "account": "myacc2", 
    "status": 429,
    "error": "Quota exceeded",
    "expiresIn": "12 min"
  },
  {
    "account": "myacc3",
    "status": "refresh_failed",
    "error": "Invalid refresh token",
    "expiresIn": "expired"
  }
]
```

**What admin sees:**
- ✅ **200**: Account working perfectly
- ⚠️ **429**: Quota exceeded (2000 req/day limit) → Already in FAILED_ACCOUNTS, will auto-reset tomorrow
- ❌ **refresh_failed**: Refresh token invalid → Remove from KV manually (account dead permanently)

### Multiple API Keys Support
```javascript
// Environment variable
OPENAI_API_KEYS=sk-admin-key,sk-user-key,sk-test-key
ADMIN_SECRET_KEY=admin-health-check-secret

// Validation
const validKeys = env.OPENAI_API_KEYS.split(",");
const userKey = request.headers.get("Authorization")?.replace("Bearer ", "");

if (!validKeys.includes(userKey)) {
  return Response.json({ error: "Invalid API key" }, { status: 401 });
}
```

## Implementation Benefits

### Same Workflow as oai-proxy
- **Familiar commands**: `npm run auth:add`, `npm run auth:list`
- **Same OAuth process**: QR code, browser, PKCE flow
- **No learning curve**: Developers already know this workflow

### True Parallel Processing
- **No queuing**: Unlike oai-proxy's request queue
- **Natural distribution**: Different requests use different accounts
- **Higher throughput**: 50+ simultaneous requests possible

### Simple Management
- **Local files**: Easy to backup, version control, inspect
- **KV deployment**: One-command deployment to production
- **Separation**: Local dev files vs production KV storage

## Migration Strategy

1. **Add authenticate.js** (copy from oai-proxy)
2. **Add setup-accounts.js** (new KV deployment script)
3. **Update package.json** scripts
4. **Modify worker auth logic** to read from KV
5. **Test with 2-3 accounts**
6. **Deploy full multi-account system**

This approach uses the exact same authentication workflow as your working oai-proxy, just adding KV deployment and true parallel processing capabilities.
