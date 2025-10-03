// --- Environment Variable Typings ---
export interface Env {
	// Multi-account system uses KV storage
	QWEN_TOKEN_CACHE: KVNamespace; // Cloudflare KV for storing multiple accounts
	
	// API authentication (supports multiple keys)
	OPENAI_API_KEYS?: string; // Comma-separated list of API keys
	ADMIN_SECRET_KEY?: string; // Admin key for health check endpoint
	
	// Legacy support (optional)
	OPENAI_API_KEY?: string; // Single API key (deprecated)
	QWEN_OAUTH_CREDS?: string; // Legacy single-account OAuth credentials (deprecated)
}

// --- OAuth2 Credentials Interface ---
export interface OAuth2Credentials {
	access_token: string;
	refresh_token: string;
	scope: string;
	token_type: string;
	id_token: string;
	expiry_date: number;
	resource_url?: string; // Optional custom API endpoint
}

// --- Qwen API Request/Response Types ---
export interface ChatCompletionRequest {
	model: string;
	messages: ChatMessage[];
	stream?: boolean;
	temperature?: number;
	max_tokens?: number;
	top_p?: number;
	tools?: Tool[];
	tool_choice?: ToolChoice;
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | ChatContent[];
	tool_calls?: ToolCall[];
	tool_call_id?: string;
}

export interface ChatContent {
	type: 'text' | 'image_url';
	text?: string;
	image_url?: {
		url: string;
		detail?: 'low' | 'high' | 'auto';
	};
}

export interface Tool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export type ToolChoice = 'none' | 'auto' | { type: 'function'; function: { name: string } };

export interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatCompletionResponse {
	id: string;
	object: 'chat.completion';
	created: number;
	model: string;
	choices: ChatCompletionChoice[];
	usage?: TokenUsage;
}

export interface ChatCompletionChoice {
	index: number;
	message: ChatMessage;
	finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}

export interface ChatCompletionStreamChunk {
	id: string;
	object: 'chat.completion.chunk';
	created: number;
	model: string;
	choices: ChatCompletionStreamChoice[];
}

export interface ChatCompletionStreamChoice {
	index: number;
	delta: {
		role?: string;
		content?: string;
		tool_calls?: ToolCall[];
	};
	finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}

export interface TokenUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

export interface ModelsResponse {
	object: 'list';
	data: ModelInfo[];
}

export interface ModelInfo {
	id: string;
	object: 'model';
	created: number;
	owned_by: string;
}

// --- OAuth Device Flow Types ---
export interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
	expires_in: number;
	interval: number;
}

export interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
}

// --- Internal Token Cache Types ---
export interface CachedTokenData {
	access_token: string;
	expiry_date: number;
	cached_at: number;
}

export interface TokenCacheInfo {
	cached: boolean;
	cached_at?: string;
	expires_at?: string;
	time_until_expiry_seconds?: number;
	is_expired?: boolean;
	message?: string;
	error?: string;
}
