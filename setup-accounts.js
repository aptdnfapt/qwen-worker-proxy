#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const toml = require('toml');

class SetupAccounts {
  constructor() {
    this.qwenDir = path.join(process.cwd(), '.qwen');
    this.wranglerConfig = null;
  }

  async loadWranglerConfig() {
    if (this.wranglerConfig) return this.wranglerConfig;
    
    try {
      const configPath = path.join(process.cwd(), 'wrangler.toml');
      const configContent = await fs.readFile(configPath, 'utf8');
      this.wranglerConfig = toml.parse(configContent);
      return this.wranglerConfig;
    } catch (error) {
      throw new Error(`Failed to load wrangler.toml: ${error.message}`);
    }
  }

  async getKvNamespaceId() {
    const config = await this.loadWranglerConfig();
    
    if (!config.kv_namespaces || config.kv_namespaces.length === 0) {
      throw new Error('No KV namespaces found in wrangler.toml');
    }
    
    return config.kv_namespaces[0].id;
  }

  async deployAccount(accountId, isRemote = false) {
    console.log(`Deploying account ${accountId} to KV storage...`);
    
    const credsPath = path.join(this.qwenDir, `oauth_creds_${accountId}.json`);
    
    try {
      const credentials = JSON.parse(await fs.readFile(credsPath, 'utf8'));
      const kvNamespaceId = await this.getKvNamespaceId();
      
      // Store credentials in KV
      const remoteFlag = isRemote ? '--remote' : '';
      const command = `wrangler kv key put "ACCOUNT:${accountId}" '${JSON.stringify(credentials)}' --namespace-id="${kvNamespaceId}" ${remoteFlag}`;
      console.log(`Executing: ${command}`);
      
      execSync(command, { stdio: 'inherit' });
      
      console.log(`✅ Account ${accountId} deployed to KV storage`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Account file not found: ${credsPath}`);
      }
      throw new Error(`Failed to deploy account ${accountId}: ${error.message}`);
    }
  }

  async deployAllAccounts(isRemote = false) {
    console.log('Deploying all accounts to KV storage...');
    
    try {
      const files = await fs.readdir(this.qwenDir);
      const accountFiles = files.filter(file => 
        file.startsWith('oauth_creds_') && file.endsWith('.json')
      );
      
      if (accountFiles.length === 0) {
        console.log('No account files found in ./.qwen/ directory.');
        return;
      }
      
      console.log(`Found ${accountFiles.length} account(s) to deploy:\n`);
      
      for (const file of accountFiles) {
        const accountId = file.replace('oauth_creds_', '').replace('.json', '');
        console.log(`- ${accountId}`);
      }
      
      console.log('\nStarting deployment...\n');
      
      for (const file of accountFiles) {
        const accountId = file.replace('oauth_creds_', '').replace('.json', '');
        await this.deployAccount(accountId, isRemote);
      }
      
      console.log('\n🎉 All accounts deployed successfully!');
    } catch (error) {
      console.error('Failed to deploy accounts:', error.message);
      process.exit(1);
    }
  }

  async listKvAccounts(isRemote = false) {
    console.log('Listing accounts in KV storage...');
    
    try {
      const kvNamespaceId = await this.getKvNamespaceId();
      
      // List all keys with ACCOUNT: prefix
      const remoteFlag = isRemote ? '--remote' : '';
      const command = `wrangler kv key list --namespace-id="${kvNamespaceId}" --prefix="ACCOUNT:" ${remoteFlag}`;
      console.log(`Executing: ${command}`);
      
      const output = execSync(command, { encoding: 'utf8' });
      
      if (!output.trim()) {
        console.log('No accounts found in KV storage.');
        return;
      }
      
      console.log('\nAccounts in KV storage:');
      console.log(output);
    } catch (error) {
      if (error.status === 1 && error.stdout && !error.stdout.trim()) {
        console.log('No accounts found in KV storage.');
        return;
      }
      throw new Error(`Failed to list KV accounts: ${error.message}`);
    }
  }

  async removeKvAccount(accountId, isRemote = false) {
    console.log(`Removing account ${accountId} from KV storage...`);
    
    try {
      const kvNamespaceId = await this.getKvNamespaceId();
      
      const remoteFlag = isRemote ? '--remote' : '';
      const command = `wrangler kv key delete "ACCOUNT:${accountId}" --namespace-id="${kvNamespaceId}" ${remoteFlag}`;
      console.log(`Executing: ${command}`);
      
      execSync(command, { stdio: 'inherit' });
      
      console.log(`✅ Account ${accountId} removed from KV storage`);
    } catch (error) {
      throw new Error(`Failed to remove account ${accountId} from KV: ${error.message}`);
    }
  }

  async healthCheck(isRemote = false) {
    console.log('Performing health check on all accounts in KV storage...');
    
    try {
      const kvNamespaceId = await this.getKvNamespaceId();
      
      // Get all account keys
      const remoteFlag = isRemote ? '--remote' : '';
      const listCommand = `wrangler kv key list --namespace-id="${kvNamespaceId}" --prefix="ACCOUNT:" ${remoteFlag}`;
      const output = execSync(listCommand, { encoding: 'utf8' });
      
      if (!output.trim()) {
        console.log('No accounts found in KV storage.');
        return;
      }
      
      // Parse account IDs from output
      const accountIds = output.trim().split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('ACCOUNT:'))
        .map(line => line.replace('ACCOUNT:', ''));
      
      console.log(`\nFound ${accountIds.length} account(s) in KV storage:\n`);
      
      const results = [];
      
      for (const accountId of accountIds) {
        console.log(`Checking account: ${accountId}`);
        
        try {
          // Get credentials from KV
          const getCommand = `wrangler kv key get "ACCOUNT:${accountId}" --namespace-id="${kvNamespaceId}"`;
          const credsOutput = execSync(getCommand, { encoding: 'utf8' });
          const credentials = JSON.parse(credsOutput);
          
          // Check expiry
          const isExpired = credentials.expiry_date < Date.now();
          const expiryMinutes = Math.floor((credentials.expiry_date - Date.now()) / 60000);
          
          // Make test API call
          const testResponse = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
            headers: {
              'Authorization': `Bearer ${credentials.access_token}`,
              'Content-Type': 'application/json'
            }
          });
          
          const result = {
            account: accountId,
            status: testResponse.status,
            error: testResponse.ok ? null : await testResponse.text(),
            expiresIn: isExpired ? 'expired' : `${expiryMinutes} min`,
            valid: !isExpired
          };
          
          results.push(result);
          
          console.log(`  Status: ${testResponse.status} ${testResponse.ok ? '✅' : '❌'}`);
          console.log(`  Expires in: ${result.expiresIn}`);
          if (!testResponse.ok) {
            console.log(`  Error: ${result.error}`);
          }
          
        } catch (error) {
          const result = {
            account: accountId,
            status: 'error',
            error: error.message,
            expiresIn: 'unknown',
            valid: false
          };
          
          results.push(result);
          
          console.log(`  Status: ❌ Error`);
          console.log(`  Error: ${error.message}`);
        }
        
        console.log('');
      }
      
      // Summary
      const validAccounts = results.filter(r => r.valid);
      const workingAccounts = results.filter(r => r.status === 200);
      
      console.log('=== Health Check Summary ===');
      console.log(`Total accounts: ${results.length}`);
      console.log(`Valid tokens: ${validAccounts.length}`);
      console.log(`Working accounts: ${workingAccounts.length}`);
      console.log(`Failed accounts: ${results.length - workingAccounts.length}`);
      
      return results;
      
    } catch (error) {
      throw new Error(`Health check failed: ${error.message}`);
    }
  }
}

// Parse command line arguments and execute
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const accountId = args[1];
  // Default to production (remote), use --dev for local development
const isRemote = !args.includes('--dev');
  
  const setup = new SetupAccounts();
  
  try {
    switch (command) {
      case 'deploy':
        if (!accountId) {
          console.error('Please provide an account ID: node setup-accounts.js deploy <account-id> [--dev]');
          process.exit(1);
        }
        await setup.deployAccount(accountId, isRemote);
        break;
        
      case 'deploy-all':
        await setup.deployAllAccounts(isRemote);
        break;
        
      case 'list-kv':
        await setup.listKvAccounts(isRemote);
        break;
        
      case 'remove-kv':
        if (!accountId) {
          console.error('Please provide an account ID: node setup-accounts.js remove-kv <account-id>');
          process.exit(1);
        }
        await setup.removeKvAccount(accountId, isRemote);
        break;
        
      case 'health':
        await setup.healthCheck(isRemote);
        break;
        
      default:
        console.log('Usage: node setup-accounts.js [deploy <account-id>|deploy-all|list-kv|remove-kv <account-id>|health] [--dev]');
        console.log('  deploy <account-id>    - Deploy single account to KV storage (production)');
        console.log('  deploy-all             - Deploy ALL accounts from ./.qwen/ to KV (production)');
        console.log('  list-kv                - List accounts currently in KV storage (production)');
        console.log('  remove-kv <account-id> - Remove account from KV storage (production)');
        console.log('  health                 - Perform health check on all accounts in KV (production)');
        console.log('  --dev                  - Use local development KV namespace instead of production');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = SetupAccounts;
