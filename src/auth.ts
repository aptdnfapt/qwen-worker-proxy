import { Env, OAuth2Credentials, CachedTokenData, TokenCacheInfo, TokenResponse, DeviceCodeResponse } from './types';
import {
	QWEN_OAUTH_DEVICE_CODE_ENDPOINT,
	QWEN_OAUTH_TOKEN_ENDPOINT,
	QWEN_OAUTH_CLIENT_ID,
	QWEN_OAUTH_SCOPE,
	QWEN_OAUTH_GRANT_TYPE,
	QWEN_API_BASE_URL,
	TOKEN_BUFFER_TIME,
	KV_TOKEN_KEY
} from './config';

/**
 * Handles OAuth2 authentication for Qwen API.
 * Manages token caching, refresh, and device flow authentication.
 */
export class QwenAuthManager {
	private env: Env;
	private accessToken: string | null = null;

	constructor(env: Env) {
		this.env = env;
	}

	/**
	 * Initializes authentication using OAuth2 credentials with KV storage caching.
	 */
	public async initializeAuth(): Promise<void> {
		if (!this.env.QWEN_OAUTH_CREDS) {
			throw new Error('QWEN_OAUTH_CREDS environment variable not set. Please provide OAuth2 credentials JSON.');
		}

		try {
			// First, try to get a cached token from KV storage
			let cachedTokenData = null;

			try {
				const cachedToken = await this.env.QWEN_TOKEN_CACHE.get(KV_TOKEN_KEY, 'json');
				if (cachedToken) {
					cachedTokenData = cachedToken as CachedTokenData;
					console.log('Found cached token in KV storage');
				}
			} catch (kvError) {
				console.log('No cached token found in KV storage or KV error:', kvError);
			}

			// Check if cached token is still valid (with buffer)
			if (cachedTokenData) {
				const timeUntilExpiry = cachedTokenData.expiry_date - Date.now();
				if (timeUntilExpiry > TOKEN_BUFFER_TIME) {
					this.accessToken = cachedTokenData.access_token;
					console.log(`Using cached token, valid for ${Math.floor(timeUntilExpiry / 1000)} more seconds`);
					return;
				}
				console.log('Cached token expired or expiring soon');
			}

			// Parse original credentials from environment
			const oauth2Creds: OAuth2Credentials = JSON.parse(this.env.QWEN_OAUTH_CREDS);

			// Check if the original token is still valid
			const timeUntilExpiry = oauth2Creds.expiry_date - Date.now();
			if (timeUntilExpiry > TOKEN_BUFFER_TIME) {
				// Original token is still valid, cache it and use it
				this.accessToken = oauth2Creds.access_token;
				console.log(`Original token is valid for ${Math.floor(timeUntilExpiry / 1000)} more seconds`);

				// Cache the token in KV storage
				await this.cacheTokenInKV(oauth2Creds.access_token, oauth2Creds.expiry_date);
				return;
			}

			// Both original and cached tokens are expired, refresh the token
			console.log('All tokens expired, refreshing...');
			await this.refreshAndCacheToken(oauth2Creds.refresh_token);
		} catch (e: unknown) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			console.error('Failed to initialize authentication:', e);
			throw new Error('Authentication failed: ' + errorMessage);
		}
	}

	/**
	 * Initiate OAuth device flow
	 */
	public async initiateDeviceFlow(): Promise<DeviceCodeResponse> {
		// Generate PKCE pair
		const codeVerifier = this.generateCodeVerifier();
		const codeChallenge = this.generateCodeChallenge(codeVerifier);

		const response = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				client_id: QWEN_OAUTH_CLIENT_ID,
				scope: QWEN_OAUTH_SCOPE,
				code_challenge: codeChallenge,
				code_challenge_method: 'S256'
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Device code request failed: ${errorText}`);
		}

		const deviceCodeResponse = await response.json() as DeviceCodeResponse;
		
		// Store code verifier in the response for later use (in production, this should be stored more securely)
		return {
			...deviceCodeResponse,
			code_verifier: codeVerifier
		} as DeviceCodeResponse & { code_verifier: string };
	}

	/**
	 * Poll for token using device code
	 */
	public async pollForToken(deviceCode: string, codeVerifier: string): Promise<string> {
		const maxAttempts = 30; // Poll for up to 5 minutes (30 * 10 seconds)
		let attempts = 0;

		while (attempts < maxAttempts) {
			try {
				const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
					},
					body: new URLSearchParams({
						client_id: QWEN_OAUTH_CLIENT_ID,
						grant_type: QWEN_OAUTH_GRANT_TYPE,
						device_code: deviceCode,
						code_verifier: codeVerifier
					})
				});

				if (response.ok) {
					const tokenData = await response.json() as TokenResponse;
					
					// Store the complete credentials in environment (for this implementation)
					const fullCredentials: OAuth2Credentials = {
						access_token: tokenData.access_token,
						refresh_token: tokenData.refresh_token || '',
						scope: tokenData.scope,
						token_type: tokenData.token_type,
						id_token: '', // Not provided in device flow response
						expiry_date: Date.now() + tokenData.expires_in * 1000
					};

					// Cache the access token
					this.accessToken = tokenData.access_token;
					await this.cacheTokenInKV(tokenData.access_token, fullCredentials.expiry_date);
					
					console.log('Authentication successful!');
					return tokenData.access_token;
				} else {
					const errorData = await response.json().catch(() => ({})) as any;
					
					// If authorization is pending, continue polling
					if (errorData.error === 'authorization_pending') {
						attempts++;
						await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
						continue;
					}
					
					// If slow down is required, wait longer
					if (errorData.error === 'slow_down') {
						attempts++;
						await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15 seconds
						continue;
					}
					
					// Other errors
					throw new Error(`Token poll failed: ${errorData.error || 'Unknown error'}`);
				}
			} catch (error) {
				if (error instanceof Error && error.message.includes('authorization_pending')) {
					attempts++;
					await new Promise(resolve => setTimeout(resolve, 10000));
					continue;
				}
				throw error;
			}
		}

		throw new Error('Authentication timeout: Please try again');
	}

	/**
	 * Refresh the OAuth token and cache it in KV storage.
	 * Matches the exact logic from the working Qwen proxy.
	 */
	private async refreshAndCacheToken(refreshToken: string): Promise<void> {
		console.log('Refreshing Qwen access token...');
		
		if (!refreshToken) {
			throw new Error('No refresh token available. Please re-authenticate with the Qwen CLI.');
		}

		const bodyData = new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: QWEN_OAUTH_CLIENT_ID,
		});

		try {
			const refreshResponse = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Accept: 'application/json',
				},
				body: bodyData,
			});

			if (!refreshResponse.ok) {
				const errorData = await refreshResponse.json() as any;
				throw new Error(`Token refresh failed: ${errorData.error} - ${errorData.error_description}`);
			}

			const tokenData = await refreshResponse.json() as TokenResponse;
			this.accessToken = tokenData.access_token;

			// Calculate expiry time (typically 1 hour from now)
			const expiryTime = Date.now() + tokenData.expires_in * 1000;

			console.log('Qwen access token refreshed successfully');
			console.log(`New token expires in ${tokenData.expires_in} seconds`);

			// Cache the new token in KV storage
			await this.cacheTokenInKV(tokenData.access_token, expiryTime);
		} catch (error) {
			console.error('Token refresh failed:', error);
			throw error;
		}
	}

	/**
	 * Cache the access token in KV storage.
	 */
	private async cacheTokenInKV(accessToken: string, expiryDate: number): Promise<void> {
		try {
			const tokenData: CachedTokenData = {
				access_token: accessToken,
				expiry_date: expiryDate,
				cached_at: Date.now()
			};

			// Cache for slightly less than the token expiry to be safe
			const ttlSeconds = Math.floor((expiryDate - Date.now()) / 1000) - 300; // 5 minutes buffer

			if (ttlSeconds > 0) {
				await this.env.QWEN_TOKEN_CACHE.put(KV_TOKEN_KEY, JSON.stringify(tokenData), {
					expirationTtl: ttlSeconds
				});
				console.log(`Token cached in KV storage with TTL of ${ttlSeconds} seconds`);
			} else {
				console.log('Token expires too soon, not caching in KV');
			}
		} catch (kvError) {
			console.error('Failed to cache token in KV storage:', kvError);
			// Don't throw an error here as the token is still valid, just not cached
		}
	}

	/**
	 * Clear cached token from KV storage.
	 */
	public async clearTokenCache(): Promise<void> {
		try {
			await this.env.QWEN_TOKEN_CACHE.delete(KV_TOKEN_KEY);
			console.log('Cleared cached token from KV storage');
		} catch (kvError) {
			console.log('Error clearing KV cache:', kvError);
		}
	}

	/**
	 * Get cached token info from KV storage.
	 */
	public async getCachedTokenInfo(): Promise<TokenCacheInfo> {
		try {
			const cachedToken = await this.env.QWEN_TOKEN_CACHE.get(KV_TOKEN_KEY, 'json');
			if (cachedToken) {
				const tokenData = cachedToken as CachedTokenData;
				const timeUntilExpiry = tokenData.expiry_date - Date.now();

				return {
					cached: true,
					cached_at: new Date(tokenData.cached_at).toISOString(),
					expires_at: new Date(tokenData.expiry_date).toISOString(),
					time_until_expiry_seconds: Math.floor(timeUntilExpiry / 1000),
					is_expired: timeUntilExpiry < 0
				};
			}
			return { cached: false, message: 'No token found in cache' };
		} catch (e: unknown) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			return { cached: false, error: errorMessage };
		}
	}

	/**
	 * A generic method to call Qwen API endpoints.
	 */
	public async callQwenAPI(endpoint: string, body: Record<string, unknown>, isRetry: boolean = false): Promise<unknown> {
		await this.initializeAuth();

		const response = await fetch(`${QWEN_API_BASE_URL}/${endpoint}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.accessToken}`,
				'User-Agent': 'QwenOpenAIProxy/1.0.0 (Cloudflare Workers)'
			},
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			if (response.status === 401 && !isRetry) {
				console.log('Got 401 error, clearing token cache and retrying...');
				this.accessToken = null; // Clear cached token
				await this.clearTokenCache(); // Clear KV cache
				await this.initializeAuth(); // This will refresh the token
				return this.callQwenAPI(endpoint, body, true); // Retry once
			}
			const errorText = await response.text();
			throw new Error(`API call failed with status ${response.status}: ${errorText}`);
		}

		return response.json();
	}

	/**
	 * Get the current access token.
	 */
	public getAccessToken(): string | null {
		return this.accessToken;
	}

	/**
	 * Get the current OAuth credentials
	 */
	public getCurrentCredentials(): OAuth2Credentials | null {
		if (!this.env.QWEN_OAUTH_CREDS) {
			return null;
		}
		try {
			return JSON.parse(this.env.QWEN_OAUTH_CREDS) as OAuth2Credentials;
		} catch (e) {
			return null;
		}
	}

	/**
	 * Generate a random code verifier for PKCE
	 */
	private generateCodeVerifier(): string {
		const array = new Uint8Array(32);
		crypto.getRandomValues(array);
		return btoa(String.fromCharCode(...array))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=/g, '');
	}

	/**
	 * Generate a code challenge from a code verifier using SHA-256
	 */
	private generateCodeChallenge(codeVerifier: string): string {
		const encoder = new TextEncoder();
		const data = encoder.encode(codeVerifier);
		return crypto.subtle.digest('SHA-256', data).then(digest => {
			return btoa(String.fromCharCode(...new Uint8Array(digest)))
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=/g, '');
		}) as any; // Type assertion for simplicity
	}
}
