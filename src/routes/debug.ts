import { Hono } from 'hono';
import { Env, DeviceCodeResponse } from '../types';
import { QwenAuthManager } from '../auth';

/**
 * Debug and utility routes for token management and testing.
 */
export const DebugRoute = new Hono<{ Bindings: Env }>();

// Token cache status
DebugRoute.get('/token', async (c) => {
	try {
		console.log('Token cache status request received');
		
		const authManager = new QwenAuthManager(c.env);
		const tokenInfo = await authManager.getCachedTokenInfo();
		
		return c.json({
			service: 'Qwen Worker Token Cache',
			status: 'active',
			...tokenInfo
		});
	} catch (error) {
		console.error('Error getting token cache info:', error);
		
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return c.json(
			{
				error: {
					message: errorMessage,
					type: 'token_cache_error'
				}
			},
			500
		);
	}
});

// Clear token cache
DebugRoute.delete('/token', async (c) => {
	try {
		console.log('Clear token cache request received');
		
		const authManager = new QwenAuthManager(c.env);
		await authManager.clearTokenCache();
		
		return c.json({
			message: 'Token cache cleared successfully',
			status: 'success'
		});
	} catch (error) {
		console.error('Error clearing token cache:', error);
		
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return c.json(
			{
				error: {
					message: errorMessage,
					type: 'clear_cache_error'
				}
			},
			500
		);
	}
});

// Initiate device flow for OAuth
DebugRoute.post('/auth/initiate', async (c) => {
	try {
		console.log('Device flow initiation request received');
		
		const authManager = new QwenAuthManager(c.env);
		const deviceFlow = await authManager.initiateDeviceFlow();
		
		// Don't expose code_verifier in the response for security
		const { code_verifier, ...response } = deviceFlow as DeviceCodeResponse & { code_verifier: string };
		
		return c.json({
			...response,
			message: 'Device flow initiated. Please visit the verification URL.',
			status: 'pending'
		});
	} catch (error) {
		console.error('Error initiating device flow:', error);
		
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return c.json(
			{
				error: {
					message: errorMessage,
					type: 'auth_initiate_error'
				}
			},
			500
		);
	}
});

// Poll for token (simplified - in production, this should handle the polling properly)
DebugRoute.post('/auth/poll', async (c) => {
	try {
		const { device_code, code_verifier } = await c.req.json();
		
		if (!device_code || !code_verifier) {
			return c.json(
				{
					error: {
						message: 'device_code and code_verifier are required',
						type: 'invalid_request'
					}
				},
				400
			);
		}
		
		console.log('Token poll request received');
		
		const authManager = new QwenAuthManager(c.env);
		const accessToken = await authManager.pollForToken(device_code, code_verifier);
		
		return c.json({
			access_token: accessToken,
			message: 'Authentication successful! Token cached and ready to use.',
			status: 'success'
		});
	} catch (error) {
		console.error('Error polling for token:', error);
		
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return c.json(
			{
				error: {
					message: errorMessage,
					type: 'auth_poll_error'
				}
			},
			500
		);
	}
});

// Test authentication (simple token validation)
DebugRoute.get('/auth/test', async (c) => {
	try {
		console.log('Authentication test request received');
		
		const authManager = new QwenAuthManager(c.env);
		await authManager.initializeAuth();
		
		const accessToken = authManager.getAccessToken();
		
		if (accessToken) {
			return c.json({
				status: 'authenticated',
				message: 'Authentication successful',
				has_token: true
			});
		} else {
			return c.json(
				{
					status: 'not_authenticated',
					message: 'No valid access token available',
					has_token: false
				},
				401
			);
		}
	} catch (error) {
		console.error('Authentication test failed:', error);
		
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return c.json(
			{
				status: 'authentication_failed',
				message: errorMessage,
				has_token: false
			},
			401
		);
	}
});

// Debug endpoint to check account credentials
DebugRoute.get('/account/:accountId', async (c) => {
	try {
		const accountId = c.req.param('accountId');
		console.log(`Checking account credentials for: ${accountId}`);
		
		// Load account credentials from KV
		const credentials = await c.env.QWEN_TOKEN_CACHE.get(`ACCOUNT:${accountId}`, 'json') as Partial<import('../types').OAuth2Credentials> | null;
		
		if (!credentials) {
			return c.json({
				account: accountId,
				status: 'not_found',
				message: 'No credentials found for this account'
			});
		}
		
		const currentTime = Date.now();
		const expiryTime = credentials.expiry_date || 0;
		const timeUntilExpiry = expiryTime - currentTime;
		const isExpired = timeUntilExpiry < 0;
		
		return c.json({
			account: accountId,
			status: 'found',
				credentials: {
					has_access_token: !!credentials.access_token,
					has_refresh_token: !!credentials.refresh_token,
					token_type: credentials.token_type,
					expiry_date: credentials.expiry_date,
					expiry_date_iso: new Date(expiryTime).toISOString(),
					time_until_expiry_ms: timeUntilExpiry,
					time_until_expiry_min: Math.floor(timeUntilExpiry / 60000),
					is_expired: isExpired,
					resource_url: credentials.resource_url
				}
		});
	} catch (error) {
		console.error('Error checking account credentials:', error);
		
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return c.json(
			{
				error: {
					message: errorMessage,
					type: 'account_check_error'
				}
			},
			500
		);
	}
});
