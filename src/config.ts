// --- Qwen OAuth Configuration ---
export const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai';
export const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
export const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
export const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
export const QWEN_OAUTH_SCOPE = 'openid profile email model.completion';
export const QWEN_OAUTH_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

// --- Qwen API Configuration ---
export const QWEN_API_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_MODEL = 'qwen3-coder-plus';

// --- Token Management ---
export const TOKEN_BUFFER_TIME = 30 * 1000; // 30 seconds
export const KV_TOKEN_KEY = 'qwen_access_token';

// --- OpenAI API Constants ---
export const OPENAI_MODEL_OWNER = 'qwen';
