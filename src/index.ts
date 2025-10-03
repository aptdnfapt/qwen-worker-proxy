import { Hono } from 'hono';
import { Env } from './types';
import { OpenAIRoute } from './routes/openai';
import { DebugRoute } from './routes/debug';

/**
 * Qwen Worker Proxy - OpenAI-Compatible Proxy for Qwen Models
 *
 * A Cloudflare Worker that provides OpenAI-compatible API endpoints
 * for Qwen's models via OAuth2 authentication.
 *
 * Features:
 * - OpenAI-compatible chat completions and model listing
 * - OAuth2 device flow authentication with automatic token refresh
 * - KV-based access token caching for performance
 * - Streaming and non-streaming response support
 * - Single model: qwen3-coder-plus
 */

// Create the main Hono app
const app = new Hono<{ Bindings: Env }>();

// Add CORS headers for all requests
app.use('*', async (c, next) => {
	// Set CORS headers
	c.header('Access-Control-Allow-Origin', '*');
	c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
	c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

	// Handle preflight requests
	if (c.req.method === 'OPTIONS') {
		c.status(204);
		return c.body(null);
	}

	await next();
});

// Multi-API key authentication middleware
app.use('/v1/*', async (c, next) => {
	// Support both new OPENAI_API_KEYS and legacy OPENAI_API_KEY
	const apiKeys = c.env.OPENAI_API_KEYS || c.env.OPENAI_API_KEY;
	
	if (apiKeys) {
		const authHeader = c.req.header('Authorization');
		
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return c.json(
				{
					error: {
						message: 'Missing or invalid Authorization header',
						type: 'authentication_error'
					}
				},
				401
			);
		}
		
		const providedKey = authHeader.substring(7); // Remove 'Bearer ' prefix
		const validKeys = apiKeys.split(',').map(key => key.trim());
		
		if (!validKeys.includes(providedKey)) {
			return c.json(
				{
					error: {
						message: 'Invalid API key',
						type: 'authentication_error'
					}
				},
				401
			);
		}
	}
	
	await next();
});

// Setup route handlers
app.route('/v1', OpenAIRoute);
app.route('/v1/debug', DebugRoute);

// Add individual debug routes to main app for backward compatibility
app.route('/debug', DebugRoute);

// Root endpoint - basic info about the service
app.get('/', (c) => {
	const requiresAuth = !!c.env.OPENAI_API_KEY;

	return c.json({
		name: 'Qwen Worker Proxy',
		description: 'OpenAI-compatible API for Qwen models via OAuth2',
		version: '1.0.0',
		authentication: {
			required: requiresAuth,
			type: requiresAuth ? 'Bearer token in Authorization header' : 'None'
		},
		endpoints: {
			chat_completions: '/v1/chat/completions',
			models: '/v1/models',
			debug: {
				token_status: '/v1/debug/token',
				auth_test: '/v1/debug/auth/test',
				auth_initiate: '/v1/debug/auth/initiate',
				auth_poll: '/v1/debug/auth/poll'
			}
		},
		models: ['qwen3-coder-plus'],
		documentation: 'https://github.com/aptdnfapt/qwen-code-oai-proxy'
	});
});

// Health check endpoint
app.get('/health', (c) => {
	return c.json({ 
		status: 'ok', 
		timestamp: new Date().toISOString(),
		service: 'Qwen Worker Multi-Account'
	});
});

// Admin health check endpoint for multi-account status
app.get('/admin/health', async (c) => {
	// Require admin authentication
	if (!c.env.ADMIN_SECRET_KEY) {
		return c.json({ error: 'Admin endpoint not configured' }, 503);
	}

	const authHeader = c.req.header('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return c.json({ error: 'Missing Authorization header' }, 401);
	}

	const providedKey = authHeader.substring(7);
	if (providedKey !== c.env.ADMIN_SECRET_KEY) {
		return c.json({ error: 'Invalid admin key' }, 401);
	}

	try {
		const { MultiAccountAuthManager } = await import('./multi-auth');
		const authManager = new MultiAccountAuthManager(c.env);
		
		const accountsHealth = await authManager.getAccountsHealth();
		const failedAccounts = await authManager.getFailedAccounts();
		
		// Summary statistics
		const totalAccounts = accountsHealth.length;
		const healthyAccounts = accountsHealth.filter(a => a.status === 'healthy').length;
		const failedAccountsCount = accountsHealth.filter(a => a.isFailed).length;
		const quotaExceededAccounts = accountsHealth.filter(a => a.status === 'quota_exceeded').length;
		const errorAccounts = accountsHealth.filter(a => a.status === 'error').length;
		const missingCredentialsAccounts = accountsHealth.filter(a => a.status === 'missing_credentials').length;

		return c.json({
			summary: {
				total_accounts: totalAccounts,
				healthy_accounts: healthyAccounts,
				failed_accounts: failedAccountsCount,
				quota_exceeded_accounts: quotaExceededAccounts,
				error_accounts: errorAccounts,
				missing_credentials_accounts: missingCredentialsAccounts,
				failed_accounts_list: failedAccounts
			},
			accounts: accountsHealth,
			timestamp: new Date().toISOString()
		});
	} catch (error) {
		console.error('Health check failed:', error);
		return c.json({
			error: 'Health check failed',
			message: error instanceof Error ? error.message : 'Unknown error',
			timestamp: new Date().toISOString()
		}, 500);
	}
});

export default app;
