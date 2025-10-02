#!/usr/bin/env node

/**
 * Local testing script for Qwen Worker
 * Tests basic endpoints without requiring real Qwen credentials
 */

const BASE_URL = 'http://localhost:8787';

async function testEndpoint(endpoint, description) {
  console.log(`\n🧪 Testing: ${description}`);
  console.log(`   URL: ${endpoint}`);
  
  try {
    const response = await fetch(endpoint);
    const status = response.status;
    const data = await response.json().catch(() => null);
    
    console.log(`   Status: ${status} ${status < 400 ? '✅' : '❌'}`);
    
    if (data) {
      console.log('   Response:', JSON.stringify(data, null, 2));
    } else {
      console.log('   Response: No JSON body');
    }
    
    return { success: status < 400, data };
  } catch (error) {
    console.log(`   Error: ${error.message} ❌`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('🚀 Qwen Worker Local Testing');
  console.log('==============================\n');
  
  console.log('Make sure your worker is running with: npm run dev');
  console.log('Worker should be available at: http://localhost:8787\n');
  
  // Test basic endpoints
  const tests = [
    {
      endpoint: `${BASE_URL}/health`,
      description: 'Health check endpoint'
    },
    {
      endpoint: `${BASE_URL}/`,
      description: 'Root info endpoint'
    },
    {
      endpoint: `${BASE_URL}/v1/models`,
      description: 'Models endpoint'
    },
    {
      endpoint: `${BASE_URL}/v1/debug/token`,
      description: 'Token cache status (will show error without credentials)'
    }
  ];
  
  const results = [];
  
  for (const test of tests) {
    const result = await testEndpoint(test.endpoint, test.description);
    results.push({ ...test, ...result });
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Summary
  console.log('\n📊 Test Summary');
  console.log('================');
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure worker is running: npm run dev');
    console.log('2. Check that port 8787 is available');
    console.log('3. Verify wrangler.toml has correct KV namespace');
    console.log('4. Check worker logs for errors');
  }
  
  if (passed === tests.length) {
    console.log('\n🎉 All tests passed! Worker is ready for credential setup.');
  }
}

// Check if localhost:8787 is responding
async function checkWorkerRunning() {
  try {
    const response = await fetch(`${BASE_URL}/health`, { 
      signal: AbortSignal.timeout(2000) 
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function main() {
  const isRunning = await checkWorkerRunning();
  
  if (!isRunning) {
    console.log('❌ Worker not detected at http://localhost:8787');
    console.log('🚀 Please start the worker with: npm run dev');
    console.log('⏳ Waiting for worker to start...');
    
    // Wait a bit and check again
    let attempts = 0;
    while (attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const running = await checkWorkerRunning();
      if (running) {
        console.log('✅ Worker detected! Running tests...\n');
        break;
      }
      attempts++;
      console.log(`   Attempt ${attempts}/10...`);
    }
    
    if (attempts >= 10) {
      console.log('❌ Worker failed to start. Please check:');
      console.log('   - npm run dev is running');
      console.log('   - Port 8787 is not blocked');
      console.log('   - wrangler.toml is configured correctly');
      process.exit(1);
    }
  }
  
  await runTests();
}

if (require.main === module) {
  main().catch(console.error);
}
