// Simple test example for the Qwen Worker
// This shows how to use the worker once deployed

const testRequest = {
  model: "qwen3-coder-plus",
  messages: [
    {
      role: "user",
      content: "Write a simple Hello World function in Python"
    }
  ],
  stream: false
};

// Example cURL command (replace with your worker URL)
const curlCommand = `curl -X POST https://your-worker.your-subdomain.workers.dev/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-api-key-here" \\
  -d '${JSON.stringify(testRequest, null, 2)}'`;

console.log("Example cURL command:");
console.log(curlCommand);

// Example JavaScript usage
console.log("\nExample JavaScript usage:");
console.log(`
const response = await fetch('https://your-worker.workers.dev/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-your-api-key-here'
  },
  body: JSON.stringify(${JSON.stringify(testRequest, null, 2)})
});

const result = await response.json();
console.log(result.choices[0].message.content);
`);

// Example Python OpenAI SDK usage
console.log("Example Python OpenAI SDK usage:");
console.log(`
from openai import OpenAI

client = OpenAI(
    base_url='https://your-worker.workers.dev/v1',
    api_key='sk-your-api-key-here'
)

response = client.chat.completions.create(
    model='qwen3-coder-plus',
    messages=[
        {'role': 'user', 'content': 'Write a simple Hello World function in Python'}
    ]
)

print(response.choices[0].message.content)
`);
