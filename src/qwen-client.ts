import { Env, ChatCompletionRequest, ChatCompletionResponse, ModelsResponse, ChatCompletionStreamChunk, OAuth2Credentials } from './types';
import { MultiAccountAuthManager } from './multi-auth';
import { QWEN_API_BASE_URL, DEFAULT_MODEL } from './config';

/**
 * Qwen API client for handling chat completions and models.
 * Simplified version adapted from the existing proxy for Cloudflare Workers.
 */
export class QwenAPIClient {
	private authManager: MultiAccountAuthManager;

	constructor(env: Env) {
		this.authManager = new MultiAccountAuthManager(env);
	}

	/**
	 * Get API endpoint from credentials, matching the working proxy exactly
	 */
	private async getApiEndpoint(credentials: OAuth2Credentials | null): Promise<string> {
		// Check if credentials contain a custom endpoint
		if (credentials && credentials.resource_url) {
			let endpoint = credentials.resource_url;
			// Ensure it has a scheme
			if (!endpoint.startsWith('http')) {
				endpoint = `https://${endpoint}`;
			}
			// Ensure it has the /v1 suffix
			if (!endpoint.endsWith('/v1')) {
				if (endpoint.endsWith('/')) {
					endpoint += 'v1';
				} else {
					endpoint += '/v1';
				}
			}
			return endpoint;
		} else {
			// Use default endpoint
			return QWEN_API_BASE_URL;
		}
	}

	/**
	 * Handle chat completion requests (both streaming and non-streaming)
	 */
	async chatCompletions(request: ChatCompletionRequest): Promise<ChatCompletionResponse | ReadableStream> {
		const { model = DEFAULT_MODEL, stream = false, ...otherParams } = request;
		let retryCount = 0;
		const maxRetries = 1; // Allow one retry with different account

		while (retryCount <= maxRetries) {
			try {
				// Prepare request body for Qwen API
				const qwenRequest = {
					model,
					...otherParams
				};

				// Get authenticated access token and credentials
				await this.authManager.initializeAuth();
				const accessToken = this.authManager.getAccessToken();
				const credentials = this.authManager.getCurrentCredentials();
				const accountId = this.authManager.getCurrentAccountId();
				
				if (!accessToken) {
					throw new Error('Failed to obtain access token');
				}

				console.log(`Using account: ${accountId || 'default'}`);

				// Get API endpoint from credentials
				const apiEndpoint = await this.getApiEndpoint(credentials);

				if (stream) {
					// Handle streaming response
					return this.handleStreamingChatCompletion(model, qwenRequest, accessToken, apiEndpoint, accountId || 'default');
				} else {
					// Handle non-streaming response
					return this.handleNonStreamingChatCompletion(model, qwenRequest, accessToken, apiEndpoint, accountId || 'default');
				}
			} catch (error) {
				console.log(`Chat completion attempt ${retryCount + 1} failed:`, error);
				
				// Handle error with account rotation
				const errorHandling = await this.authManager.handleApiError(error, retryCount);
				
				if (!errorHandling.shouldRetry) {
					throw error;
				}

				if (errorHandling.newAccount) {
					console.log('Switching to different account for retry...');
					const switched = await this.authManager.switchAccount();
					if (!switched) {
						throw new Error('No alternative accounts available for retry');
					}
				}

				retryCount++;
			}
		}

		throw new Error('Maximum retries exceeded');
	}

	/**
	 * Handle non-streaming chat completion
	 */
	private async handleNonStreamingChatCompletion(
		model: string,
		requestBody: Record<string, unknown>,
		accessToken: string,
		apiEndpoint: string,
		accountId: string
	): Promise<ChatCompletionResponse> {
		// Prepare payload matching the working proxy exactly
		const payload = {
			model: model || DEFAULT_MODEL,
			messages: requestBody.messages,
			temperature: requestBody.temperature,
			max_tokens: requestBody.max_tokens,
			top_p: requestBody.top_p,
			tools: requestBody.tools,
			tool_choice: requestBody.tool_choice
		};

		const response = await fetch(`${apiEndpoint}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${accessToken}`,
				'User-Agent': 'QwenOpenAIProxy/1.0.0 (Cloudflare Workers)'
			},
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Qwen API error: ${response.status} - ${errorText}`);
		}

		const qwenResponse = await response.json() as any;

		// Transform Qwen response to OpenAI format (they're already compatible)
		return {
			id: qwenResponse.id || `chatcmpl-${crypto.randomUUID()}`,
			object: 'chat.completion',
			created: qwenResponse.created || Math.floor(Date.now() / 1000),
			model: qwenResponse.model || model,
			choices: qwenResponse.choices || [],
			usage: qwenResponse.usage
		};
	}

	/**
	 * Handle streaming chat completion
	 */
	private async handleStreamingChatCompletion(
		model: string,
		requestBody: Record<string, unknown>,
		accessToken: string,
		apiEndpoint: string,
		accountId: string
	): Promise<ReadableStream> {
		// Prepare payload matching the working proxy exactly
		const payload = {
			model: model || DEFAULT_MODEL,
			messages: requestBody.messages,
			temperature: requestBody.temperature,
			max_tokens: requestBody.max_tokens,
			top_p: requestBody.top_p,
			tools: requestBody.tools,
			tool_choice: requestBody.tool_choice,
			stream: true
		};

		const response = await fetch(`${apiEndpoint}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${accessToken}`,
				'User-Agent': 'QwenOpenAIProxy/1.0.0 (Cloudflare Workers)'
			},
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Qwen API error: ${response.status} - ${errorText}`);
		}

		if (!response.body) {
			throw new Error('No response body from Qwen API');
		}

		// Create a transform stream to process SSE data
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		const reader = response.body.getReader();
		const decoder = new TextDecoder();

		// Process the stream
		this.processSSEStream(reader, decoder, writer, model);

		return readable;
	}

	/**
	 * Process Server-Sent Events stream from Qwen API
	 */
	private async processSSEStream(
		reader: ReadableStreamDefaultReader<Uint8Array>,
		decoder: TextDecoder,
		writer: WritableStreamDefaultWriter<Uint8Array>,
		model: string
	): Promise<void> {
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || ''; // Keep incomplete line in buffer

				for (const line of lines) {
					if (line.trim() === '') continue;
					if (line.startsWith('data: ')) {
						const data = line.substring(6);
						if (data === '[DONE]') {
							await writer.write(new TextEncoder().encode('data: [DONE]\n\n'));
							await writer.close();
							return;
						}

						try {
							const chunk = JSON.parse(data) as ChatCompletionStreamChunk;
							
							// Ensure chunk has proper OpenAI format
							const formattedChunk: ChatCompletionStreamChunk = {
								id: chunk.id || `chatcmpl-${crypto.randomUUID()}`,
								object: 'chat.completion.chunk',
								created: chunk.created || Math.floor(Date.now() / 1000),
								model: chunk.model || model,
								choices: chunk.choices || []
							};

							const chunkData = `data: ${JSON.stringify(formattedChunk)}\n\n`;
							await writer.write(new TextEncoder().encode(chunkData));
						} catch (parseError) {
							console.error('Failed to parse SSE chunk:', parseError);
							// Skip invalid chunks
						}
					}
				}
			}

			// Stream finished
			await writer.write(new TextEncoder().encode('data: [DONE]\n\n'));
			await writer.close();
		} catch (error) {
			console.error('Error processing stream:', error);
			
			// Send error chunk
			const errorChunk = {
				id: `chatcmpl-${crypto.randomUUID()}`,
				object: 'chat.completion.chunk',
				created: Math.floor(Date.now() / 1000),
				model: model,
				choices: [{
					index: 0,
					delta: {
						content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
					},
					finish_reason: 'stop'
				}]
			};

			try {
				await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
				await writer.write(new TextEncoder().encode('data: [DONE]\n\n'));
			} catch (writeError) {
				console.error('Failed to write error chunk:', writeError);
			}
			
			await writer.close();
		}
	}

	/**
	 * List available models
	 */
	async listModels(): Promise<ModelsResponse> {
		return {
			object: 'list',
			data: [
				{
					id: 'qwen3-coder-plus',
					object: 'model',
					created: 1754686206,
					owned_by: 'qwen'
				}
			]
		};
	}

	/**
	 * Get token cache information (deprecated for multi-account)
	 */
	async getTokenCacheInfo() {
		// Multi-account system manages tokens differently
		return { message: 'Token cache info not applicable for multi-account system' };
	}

	/**
	 * Clear token cache (deprecated for multi-account)
	 */
	async clearTokenCache() {
		// Multi-account system doesn't need cache clearing
		console.log('Clear token cache not applicable for multi-account system');
	}
}
