#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const qrcode = require('qrcode-terminal');
const open = require('open');

class QwenAuthManager {
  constructor() {
    this.qwenDir = path.join(process.cwd(), '.qwen');
    // Qwen OAuth Configuration (from working oai-proxy)
    this.oauthBaseUrl = 'https://chat.qwen.ai';
    this.deviceCodeEndpoint = `${this.oauthBaseUrl}/api/v1/oauth2/device/code`;
    this.tokenEndpoint = `${this.oauthBaseUrl}/api/v1/oauth2/token`;
    this.clientId = 'f0304373b74a44d2b584a3fb70ca9e56';
    this.scope = 'openid profile email model.completion';
    this.grantType = 'urn:ietf:params:oauth:grant-type:device_code';
  }

  async ensureDir() {
    try {
      await fs.mkdir(this.qwenDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  generateCodeVerifier(length = 128) {
    return crypto.randomBytes(length).toString('base64url');
  }

  generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  async initiateDeviceFlow() {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    const response = await fetch(this.deviceCodeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        scope: this.scope,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Device flow initiation failed: ${response.status} ${response.statusText}. Response: ${errorData}`);
    }

    const data = await response.json();
    
    if (!data.device_code) {
      throw new Error(`Device authorization failed: ${data.error || 'Unknown error'} - ${data.error_description || 'No details provided'}`);
    }
    
    return {
      ...data,
      code_verifier: codeVerifier,
      verification_uri_complete: data.verification_uri_complete || data.verification_uri,
    };
  }

  async pollForToken(deviceCode, codeVerifier, accountId = null) {
    let pollInterval = 5000; // 5 seconds
    const maxAttempts = 60; // 5 minutes max

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const bodyData = new URLSearchParams({
        grant_type: this.grantType,
        client_id: this.clientId,
        device_code: deviceCode,
        code_verifier: codeVerifier,
      });

      try {
        const response = await fetch(this.tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: bodyData,
        });

        if (!response.ok) {
          // Parse the response as JSON to check for OAuth RFC 8628 standard errors
          try {
            const errorData = await response.json();

            // According to OAuth RFC 8628, handle standard polling responses
            if (response.status === 400 && errorData.error === 'authorization_pending') {
              // User has not yet approved the authorization request. Continue polling.
              console.log(`Polling attempt ${attempt + 1}/${maxAttempts}...`);
              await new Promise(resolve => setTimeout(resolve, pollInterval));
              continue;
            }

            if (response.status === 400 && errorData.error === 'slow_down') {
              // Client is polling too frequently. Increase poll interval.
              pollInterval = Math.min(pollInterval * 1.5, 10000); // Increase by 50%, max 10 seconds
              console.log(`Server requested to slow down, increasing poll interval to ${pollInterval}ms`);
              await new Promise(resolve => setTimeout(resolve, pollInterval));
              continue;
            }

            if (response.status === 400 && errorData.error === 'expired_token') {
              throw new Error('Device code expired. Please restart the authentication process.');
            }

            if (response.status === 400 && errorData.error === 'access_denied') {
              throw new Error('Authorization denied by user. Please restart the authentication process.');
            }

            // For other errors, throw with proper error information
            throw new Error(`Device token poll failed: ${errorData.error || 'Unknown error'} - ${errorData.error_description || 'No details provided'}`);
          } catch (_parseError) {
            // If JSON parsing fails, fall back to text response
            const errorData = await response.text();
            throw new Error(`Device token poll failed: ${response.status} ${response.statusText}. Response: ${errorData}`);
          }
        }

        const tokenData = await response.json();
        
        // Convert to credentials format and save
        const credentials = {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || undefined,
          token_type: tokenData.token_type,
          resource_url: tokenData.resource_url || tokenData.endpoint,
          expiry_date: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
        };

        // Save credentials
        if (accountId) {
          await this.saveAccountCredentials(accountId, credentials);
        } else {
          await this.saveCredentials(credentials);
        }
        
        return credentials;
      } catch (error) {
        // Handle specific error cases
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // If we get a specific OAuth error that should stop polling, throw it
        if (errorMessage.includes('expired_token') || 
            errorMessage.includes('access_denied') || 
            errorMessage.includes('Device authorization failed')) {
          throw error;
        }
        
        // For other errors, continue polling
        console.log(`Polling attempt ${attempt + 1}/${maxAttempts} failed:`, errorMessage);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error('Authentication timeout. Please restart the authentication process.');
  }

  async saveCredentials(credentials) {
    await this.ensureDir();
    const filePath = path.join(this.qwenDir, 'oauth_creds.json');
    await fs.writeFile(filePath, JSON.stringify(credentials, null, 2));
  }

  async saveAccountCredentials(accountId, credentials) {
    await this.ensureDir();
    const filePath = path.join(this.qwenDir, `oauth_creds_${accountId}.json`);
    await fs.writeFile(filePath, JSON.stringify(credentials, null, 2));
  }

  async loadCredentials() {
    try {
      const filePath = path.join(this.qwenDir, 'oauth_creds.json');
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async loadAccountCredentials(accountId) {
    try {
      const filePath = path.join(this.qwenDir, `oauth_creds_${accountId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async loadAllAccounts() {
    await this.ensureDir();
    try {
      const files = await fs.readdir(this.qwenDir);
      const accountFiles = files.filter(file => 
        file.startsWith('oauth_creds_') && file.endsWith('.json')
      );
      
      return accountFiles.map(file => 
        file.replace('oauth_creds_', '').replace('.json', '')
      );
    } catch (error) {
      return [];
    }
  }

  isTokenValid(credentials) {
    return credentials && credentials.expiry_date > Date.now();
  }

  async removeAccount(accountId) {
    const filePath = path.join(this.qwenDir, `oauth_creds_${accountId}.json`);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Account ${accountId} not found`);
      }
      throw error;
    }
  }
}

async function listAccounts() {
  console.log('Listing all Qwen accounts...');
  
  try {
    const authManager = new QwenAuthManager();
    const accountIds = await authManager.loadAllAccounts();
    
    if (accountIds.length === 0) {
      console.log('No accounts found in ./.qwen/ directory.');
      return;
    }
    
    console.log(`\nFound ${accountIds.length} account(s):\n`);
    
    for (const accountId of accountIds) {
      const credentials = await authManager.loadAccountCredentials(accountId);
      const isValid = authManager.isTokenValid(credentials);
      
      console.log(`Account ID: ${accountId}`);
      console.log(`  Status: ${isValid ? '✅ Valid' : '❌ Invalid/Expired'}`);
      if (credentials && credentials.expiry_date) {
        const expiry = new Date(credentials.expiry_date);
        console.log(`  Expires: ${expiry.toLocaleString()}`);
      }
      console.log('');
    }
  } catch (error) {
    console.error('Failed to list accounts:', error.message);
    process.exit(1);
  }
}

async function addAccount(accountId) {
  console.log(`Adding new Qwen account with ID: ${accountId}...`);
  
  try {
    const authManager = new QwenAuthManager();
    
    // Initiate device flow
    console.log('\nInitiating device flow...');
    const deviceFlow = await authManager.initiateDeviceFlow();
    
    // Display verification URI and user code
    console.log('\n=== Qwen OAuth Device Authorization ===');
    console.log('Please visit the following URL to authenticate:');
    console.log(`\n${deviceFlow.verification_uri_complete}\n`);
    
    // Generate and display QR code
    console.log('Or scan the QR code below:');
    qrcode.generate(deviceFlow.verification_uri_complete, { small: true }, (qrCode) => {
      console.log(qrCode);
    });
    
    console.log('User code:', deviceFlow.user_code);
    console.log('(Press Ctrl+C to cancel)');
    
    // Try to open the URL in the browser
    try {
      await open(deviceFlow.verification_uri_complete);
      console.log('\nBrowser opened automatically. If not, please visit the URL above.');
    } catch (openError) {
      console.log('\nPlease visit the URL above in your browser to authenticate.');
    }
    
    // Poll for token and save to specific account
    console.log('\nWaiting for authentication...');
    const token = await authManager.pollForToken(deviceFlow.device_code, deviceFlow.code_verifier, accountId);
    
    console.log(`\n🎉 Authentication successful for account ${accountId}!`);
    console.log(`Access token saved to ./.qwen/oauth_creds_${accountId}.json`);
  } catch (error) {
    console.error('Authentication failed:', error.message);
    process.exit(1);
  }
}

async function removeAccount(accountId) {
  console.log(`Removing Qwen account with ID: ${accountId}...`);
  
  try {
    const authManager = new QwenAuthManager();
    await authManager.removeAccount(accountId);
    console.log(`\n✅ Account ${accountId} removed successfully!`);
  } catch (error) {
    console.error('Failed to remove account:', error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'list':
    listAccounts();
    break;
  case 'add':
    if (!args[1]) {
      console.error('Please provide an account ID: node authenticate.js add <account-id>');
      process.exit(1);
    }
    addAccount(args[1]);
    break;
  case 'remove':
    if (!args[1]) {
      console.error('Please provide an account ID: node authenticate.js remove <account-id>');
      process.exit(1);
    }
    removeAccount(args[1]);
    break;
  default:
    console.log('Usage: node authenticate.js [list|add <account-id>|remove <account-id>]');
    console.log('  list                - List all accounts');
    console.log('  add <account-id>    - Add a new account with the specified ID');
    console.log('  remove <account-id> - Remove an existing account with the specified ID');
    process.exit(1);
}
