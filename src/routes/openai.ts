import { Hono } from 'hono';
import { Env, ChatCompletionRequest } from '../types';
import { QwenAPIClient } from '../qwen-client';

/**
 * OpenAI-compatible API routes for chat completions and models.
 */
export const OpenAIRoute = new Hono<{ Bindings: Env }>();

// List available models
OpenAIRoute.get('/models', async (c) => {
	try {
		console.log('Models request received');
		
		const qwenClient = new QwenAPIClient(c.env);
		const models = await qwenClient.listModels();
		
		console.log('Models request processed successfully');
		return c.json(models);
	} catch (error) {
		console.error('Error fetching models:', error);
		
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return c.json(
			{
				error: {
					message: errorMessage,
					type: 'models_error'
				}
			},
			500
		);
	}
});

// Chat completions endpoint
OpenAIRoute.post('/chat/completions', async (c) => {
	try {
		console.log('Chat completions request received');
		
		const body = await c.req.json<ChatCompletionRequest>();
		const { model, stream = false } = body;

		console.log('Request details:', {
			model,
			stream,
			messageCount: body.messages?.length || 0
		});

		if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
			return c.json(
				{
					error: {
						message: 'messages is a required field and must be a non-empty array',
						type: 'invalid_request_error'
					}
				},
				400
			);
		}

		// Initialize Qwen client
		const qwenClient = new QwenAPIClient(c.env);

		if (stream) {
			// Streaming response
			console.log('Starting streaming chat completion');
			
			const streamResponse = await qwenClient.chatCompletions(body);
			
			if (streamResponse instanceof ReadableStream) {
				console.log('Streaming response initiated');
				
				return new Response(streamResponse, {
					headers: {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						'Connection': 'keep-alive',
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
						'Access-Control-Allow-Headers': 'Content-Type, Authorization'
					}
				});
			} else {
				// Fallback to non-streaming if streaming failed
				console.log('Streaming failed, falling back to non-streaming');
				return c.json(streamResponse);
			}
		} else {
			// Non-streaming response
			console.log('Starting non-streaming chat completion');
			
			const completion = await qwenClient.chatCompletions(body);
			
			console.log('Non-streaming completion processed successfully');
			return c.json(completion);
		}
	} catch (error) {
		console.error('Error in chat completions:', error);
		
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		
		// Handle authentication errors
		if (errorMessage.includes('Authentication failed') || errorMessage.includes('access token')) {
			return c.json(
				{
					error: {
						message: 'Authentication failed with Qwen. Please check your OAuth credentials.',
						type: 'authentication_error'
					}
				},
				401
			);
		}
		
		// Handle quota/rate limit errors
		if (errorMessage.includes('quota') || errorMessage.includes('rate limit') || errorMessage.includes('429')) {
			return c.json(
				{
					error: {
						message: 'Quota exceeded or rate limited. Please try again later.',
						type: 'rate_limit_error'
					}
				},
				429
			);
		}
		
		// Generic error
		return c.json(
			{
				error: {
					message: errorMessage,
					type: 'internal_server_error'
				}
			},
			500
		);
	}
});
