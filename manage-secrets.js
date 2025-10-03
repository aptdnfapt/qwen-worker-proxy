#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found!');
    console.log('\n📝 Create a .env file first:');
    console.log('   cp .env.example .env');
    console.log('   nano .env  # Edit with your values');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};
  
  envContent.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    
    const [key, ...valueParts] = line.split('=');
    const value = valueParts.join('=').trim();
    
    if (key && value) {
      env[key.trim()] = value;
    }
  });

  return env;
}

function updateSecret(name, value) {
  try {
    console.log(`Updating ${name}...`);
    execSync(`echo "${value}" | wrangler secret put ${name}`, { 
      stdio: ['pipe', 'inherit', 'inherit'],
      input: value
    });
    console.log(`✅ ${name} updated\n`);
  } catch (error) {
    console.error(`❌ Failed to update ${name}:`, error.message);
    throw error;
  }
}

function updateSecrets() {
  console.log('\n🔐 Updating Cloudflare Worker Secrets from .env');
  console.log('================================================\n');

  const env = loadEnvFile();
  const secrets = ['OPENAI_API_KEYS', 'ADMIN_SECRET_KEY'];
  
  let updated = 0;
  let skipped = 0;

  for (const secretName of secrets) {
    if (env[secretName]) {
      updateSecret(secretName, env[secretName]);
      updated++;
    } else {
      console.log(`⚠️  ${secretName} not found in .env, skipping\n`);
      skipped++;
    }
  }

  console.log('================================================');
  console.log(`✅ Updated: ${updated} secrets`);
  if (skipped > 0) {
    console.log(`⚠️  Skipped: ${skipped} secrets (not in .env)`);
  }
  console.log('\n💡 Verify with: npm run secrets:list');
}

function listSecrets() {
  console.log('\n📋 Listing Cloudflare Worker Secrets');
  console.log('=====================================\n');
  
  try {
    execSync('wrangler secret list', { stdio: 'inherit' });
  } catch (error) {
    console.error('❌ Failed to list secrets:', error.message);
    process.exit(1);
  }
}

function main() {
  const command = process.argv[2];

  if (command === 'list') {
    listSecrets();
  } else {
    updateSecrets();
  }
}

main();
