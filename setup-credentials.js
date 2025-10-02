#!/usr/bin/env node

/**
 * Helper script to guide users through setting up Qwen OAuth credentials
 * This script helps extract credentials from an existing Qwen proxy setup
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🚀 Qwen Worker Credential Setup Helper');
console.log('=====================================\n');

function findQwenCredentials() {
  const homeDir = os.homedir();
  const qwenDir = path.join(homeDir, '.qwen');
  
  console.log('📁 Looking for Qwen credentials in:', qwenDir);
  
  if (!fs.existsSync(qwenDir)) {
    console.log('❌ Qwen directory not found. Please authenticate first:');
    console.log('   cd your-qwen-proxy-directory && npm run auth');
    return null;
  }
  
  // Look for default credential file
  const defaultCredsPath = path.join(qwenDir, 'oauth_creds.json');
  if (fs.existsSync(defaultCredsPath)) {
    console.log('✅ Found default credentials:', defaultCredsPath);
    return defaultCredsPath;
  }
  
  // Look for multi-account credential files
  try {
    const files = fs.readdirSync(qwenDir);
    const credFiles = files.filter(file => 
      file.startsWith('oauth_creds_') && file.endsWith('.json')
    );
    
    if (credFiles.length > 0) {
      console.log('✅ Found multi-account credentials:');
      credFiles.forEach(file => console.log('   -', file));
      return path.join(qwenDir, credFiles[0]);
    }
  } catch (error) {
    console.log('❌ Error reading Qwen directory:', error.message);
  }
  
  console.log('❌ No credential files found. Please authenticate first:');
  console.log('   cd your-qwen-proxy-directory && npm run auth');
  return null;
}

function displayCredentials(credsPath) {
  try {
    const credsContent = fs.readFileSync(credsPath, 'utf8');
    const credentials = JSON.parse(credsContent);
    
    console.log('\n📋 Your Qwen OAuth Credentials:');
    console.log(JSON.stringify(credentials, null, 2));
    
    console.log('\n🔧 Setup Instructions:');
    console.log('1. Copy the JSON above');
    console.log('2. Run: wrangler secret put QWEN_OAUTH_CREDS');
    console.log('3. Paste the JSON when prompted');
    console.log('4. Deploy with: npm run deploy');
    
    console.log('\n🔗 Worker will be available at:');
    console.log('   https://your-worker.your-subdomain.workers.dev');
    
    console.log('\n🧪 Test with:');
    console.log('   curl https://your-worker.workers.dev/v1/models');
    
  } catch (error) {
    console.log('❌ Error reading credentials:', error.message);
  }
}

function main() {
  const credsPath = findQwenCredentials();
  
  if (credsPath) {
    displayCredentials(credsPath);
  } else {
    process.exit(1);
  }
}

main();
