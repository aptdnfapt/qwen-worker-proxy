import { Env, OAuth2Credentials } from './types';
import { QWEN_OAUTH_CLIENT_ID } from './config';

/**
 * Multi-account authentication manager for Qwen API.
 * Supports probability-based account selection and failure handling.
 */
export class MultiAccountAuthManager {
	private env: Env;
	private selectedAccount: string | null = null;
	private selectedCredentials: OAuth2Credentials | null = null;

	constructor(env: Env) {
		this.env = env;
	}

	/**
	 * Get all account IDs from KV storage
	 */
	private async getAllAccountIds(): Promise<string[]> {
		try {
			console.log('DEBUG: Attempting to list accounts with prefix ACCOUNT:');
			// List all keys with ACCOUNT: prefix
			const list = await this.env.QWEN_TOKEN_CACHE.list({ prefix: 'ACCOUNT:' });
			console.log('DEBUG: KV list result:', JSON.stringify(list));
			const accountIds = list.keys.map(key => key.name.replace('ACCOUNT:', ''));
			console.log('DEBUG: Extracted account IDs:', accountIds);
			return accountIds;
		} catch (error) {
			console.error('DEBUG: Failed to list accounts:', error);
			return [];
		}
	}

	/**
	 * Get failed accounts list from KV
	 * Automatically resets the list if it's a new UTC day
	 */
	public async getFailedAccounts(): Promise<string[]> {
		try {
			// Check if we need to reset the failed accounts list (new UTC day)
			await this.checkAndResetFailedAccounts();
			
			const failed = await this.env.QWEN_TOKEN_CACHE.get('FAILED_ACCOUNTS') || '';
			return failed.split(',').filter(Boolean);
		} catch (error) {
			console.error('Failed to get failed accounts:', error);
			return [];
		}
	}

	/**
	 * Check if it's a new UTC day and reset FAILED_ACCOUNTS list if needed
	 */
	private async checkAndResetFailedAccounts(): Promise<void> {
		try {
			const lastResetDate = await this.env.QWEN_TOKEN_CACHE.get('LAST_FAILED_RESET_DATE');
			const currentUtcDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
			
			// If it's a new day, reset the failed accounts list
			if (lastResetDate !== currentUtcDate) {
				console.log(`New UTC day detected (${currentUtcDate}), resetting FAILED_ACCOUNTS list...`);
				await this.env.QWEN_TOKEN_CACHE.put('FAILED_ACCOUNTS', '');
				await this.env.QWEN_TOKEN_CACHE.put('LAST_FAILED_RESET_DATE', currentUtcDate);
				console.log('FAILED_ACCOUNTS list reset successfully');
			}
		} catch (error) {
			console.error('Failed to check/reset failed accounts:', error);
		}
	}

	/**
	 * Add account to failed list
	 */
	private async markAccountAsFailed(accountId: string): Promise<void> {
		try {
			const failed = await this.getFailedAccounts();
			if (!failed.includes(accountId)) {
				failed.push(accountId);
				await this.env.QWEN_TOKEN_CACHE.put('FAILED_ACCOUNTS', failed.join(','));
				console.log(`Marked account ${accountId} as failed`);
			}
		} catch (error) {
			console.error('Failed to mark account as failed:', error);
		}
	}

	/**
	 * Load credentials for a specific account from KV
	 */
	private async loadAccountCredentials(accountId: string): Promise<OAuth2Credentials | null> {
		try {
			const creds = await this.env.QWEN_TOKEN_CACHE.get(`ACCOUNT:${accountId}`, 'json');
			return creds as OAuth2Credentials | null;
		} catch (error) {
			console.error(`Failed to load credentials for ${accountId}:`, error);
			return null;
		}
	}

	/**
	 * Refresh token for a specific account
	 */
	private async refreshAccountToken(accountId: string, refreshToken: string): Promise<OAuth2Credentials> {
		console.log(`Refreshing token for account ${accountId}...`);

		const response = await fetch('https://chat.qwen.ai/api/v1/oauth2/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_id: QWEN_OAUTH_CLIENT_ID,
			}),
		});

		if (!response.ok) {
			const errorData = await response.json() as any;
			throw new Error(`Token refresh failed for ${accountId}: ${errorData.error} - ${errorData.error_description}`);
		}

		const tokenData = await response.json() as any;
		
		const newCredentials: OAuth2Credentials = {
			access_token: tokenData.access_token,
			refresh_token: tokenData.refresh_token || refreshToken,
			scope: tokenData.scope || '',
			token_type: tokenData.token_type || 'Bearer',
			id_token: tokenData.id_token || '',
			expiry_date: Date.now() + tokenData.expires_in * 1000
		};

		// Store updated credentials in KV
		await this.env.QWEN_TOKEN_CACHE.put(`ACCOUNT:${accountId}`, JSON.stringify(newCredentials));
		console.log(`Successfully refreshed token for ${accountId}`);

		return newCredentials;
	}

	/**
	 * Weighted random selection based on account freshness
	 */
	private async selectBestAccount(): Promise<{ accountId: string; credentials: OAuth2Credentials } | null> {
		const allAccountIds = await this.getAllAccountIds();
		const failedAccounts = await this.getFailedAccounts();

		// Filter out failed accounts
		const availableAccountIds = allAccountIds.filter(id => !failedAccounts.includes(id));

		if (availableAccountIds.length === 0) {
			console.log('No available accounts (all accounts failed)');
			return null;
		}

		console.log(`Available accounts: ${availableAccountIds.join(', ')}`);

		// Load credentials and calculate weights
		const accountWeights = [];
		let maxFreshness = -Infinity;

		for (const accountId of availableAccountIds) {
			const credentials = await this.loadAccountCredentials(accountId);
			if (!credentials) {
				console.log(`No credentials found for ${accountId}, skipping`);
				continue;
			}

			const minutesLeft = (credentials.expiry_date - Date.now()) / 60000;
			maxFreshness = Math.max(maxFreshness, minutesLeft);

			accountWeights.push({
				accountId,
				credentials,
				minutesLeft
			});
		}

		if (accountWeights.length === 0) {
			console.log('No valid credentials found for any account');
			return null;
		}

		// Calculate probabilities based on freshness
		const weightedAccounts = accountWeights.map(account => {
			let probability: number;

			if (account.minutesLeft < 0) {
				// Expired: 10% chance to trigger proactive refresh
				probability = 0.1;
			} else if (account.minutesLeft === maxFreshness) {
				// Freshest: 85% probability
				probability = 0.85;
			} else if (account.minutesLeft > 30) {
				probability = 0.7;
			} else if (account.minutesLeft > 20) {
				probability = 0.5;
			} else if (account.minutesLeft > 10) {
				probability = 0.3;
			} else if (account.minutesLeft > 5) {
				probability = 0.1;
			} else {
				probability = 0.05;
			}

			return { ...account, probability };
		});

		// Weighted random selection
		const random = Math.random();
		let cumulativeProbability = 0;

		for (const account of weightedAccounts) {
			cumulativeProbability += account.probability;
			if (random <= cumulativeProbability) {
				console.log(`Selected account ${account.accountId} (probability: ${account.probability}, minutes left: ${account.minutesLeft.toFixed(1)})`);
				return { accountId: account.accountId, credentials: account.credentials };
			}
		}

		// Fallback (shouldn't reach here)
		const fallback = weightedAccounts[0];
		console.log(`Fallback to account ${fallback.accountId}`);
		return { accountId: fallback.accountId, credentials: fallback.credentials };
	}

	/**
	 * Initialize authentication and select best account
	 */
	public async initializeAuth(): Promise<void> {
		if (this.selectedAccount && this.selectedCredentials) {
			// Check if current credentials are still valid
			const minutesLeft = (this.selectedCredentials.expiry_date - Date.now()) / 60000;
			if (minutesLeft > 5) {
				console.log(`Using existing valid account ${this.selectedAccount} (${minutesLeft.toFixed(1)} minutes left)`);
				return;
			}
		}

		// Select best account
		const selection = await this.selectBestAccount();
		if (!selection) {
			throw new Error('No valid accounts available. All accounts may be failed or expired.');
		}

		// Handle expired accounts with proactive refresh
		if (selection.credentials.expiry_date < Date.now()) {
			console.log(`Selected account ${selection.accountId} has expired token, attempting proactive refresh...`);
			try {
				this.selectedCredentials = await this.refreshAccountToken(
					selection.accountId, 
					selection.credentials.refresh_token
				);
				this.selectedAccount = selection.accountId;
				console.log(`Proactive refresh successful for ${selection.accountId}`);
			} catch (refreshError) {
				console.log(`Proactive refresh failed for ${selection.accountId}, trying freshest account...`);
				
				// Find freshest account and use it instead
				const allAccountIds = await this.getAllAccountIds();
				const failedAccounts = await this.getFailedAccounts();
				const availableIds = allAccountIds.filter(id => !failedAccounts.includes(id) && id !== selection.accountId);
				
				for (const accountId of availableIds) {
					const creds = await this.loadAccountCredentials(accountId);
					if (creds && creds.expiry_date > Date.now()) {
						this.selectedAccount = accountId;
						this.selectedCredentials = creds;
						console.log(`Switched to freshest account ${accountId}`);
						return;
					}
				}
				
				throw new Error(`No valid accounts available. Proactive refresh failed for ${selection.accountId}: ${refreshError}`);
			}
		} else {
			this.selectedAccount = selection.accountId;
			this.selectedCredentials = selection.credentials;
		}
	}

	/**
	 * Get current access token
	 */
	public getAccessToken(): string | null {
		return this.selectedCredentials?.access_token || null;
	}

	/**
	 * Get current account ID
	 */
	public getCurrentAccountId(): string | null {
		return this.selectedAccount;
	}

	/**
	 * Get current credentials
	 */
	public getCurrentCredentials(): OAuth2Credentials | null {
		return this.selectedCredentials;
	}

	/**
	 * Handle API response errors with account rotation
	 */
	public async handleApiError(error: any, retryCount: number = 0): Promise<{ shouldRetry: boolean; newAccount?: boolean }> {
		if (!this.selectedAccount) {
			return { shouldRetry: false };
		}

		const errorMessage = error instanceof Error ? error.message : String(error);
		const statusCode = this.extractStatusCode(errorMessage);

		console.log(`Handling API error for account ${this.selectedAccount}: ${errorMessage} (status: ${statusCode})`);

		// Type 1: Token Expired (401) - Auto-refresh and retry same account
		if (statusCode === 401 || errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
			if (this.selectedCredentials?.refresh_token && retryCount === 0) {
				try {
					console.log(`Token expired for ${this.selectedAccount}, refreshing...`);
					await this.refreshAccountToken(this.selectedAccount, this.selectedCredentials.refresh_token);
					
					// Reload the refreshed credentials
					const refreshed = await this.loadAccountCredentials(this.selectedAccount);
					if (refreshed) {
						this.selectedCredentials = refreshed;
						console.log(`Successfully refreshed token for ${this.selectedAccount}`);
						return { shouldRetry: true, newAccount: false };
					}
				} catch (refreshError) {
					console.log(`Token refresh failed for ${this.selectedAccount}:`, refreshError);
				}
			}
			
			// If refresh failed or no refresh token, mark as failed and try different account
			await this.markAccountAsFailed(this.selectedAccount);
			return { shouldRetry: retryCount === 0, newAccount: true };
		}

		// Type 2: Quota Exceeded (429) - Mark as failed and try different account
		if (statusCode === 429 || errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
			await this.markAccountAsFailed(this.selectedAccount);
			return { shouldRetry: retryCount === 0, newAccount: true };
		}

		// Type 3: Server Errors (500/502/504) - Try different account, no KV write
		if (statusCode === 500 || statusCode === 502 || statusCode === 504 || 
			errorMessage.includes('500') || errorMessage.includes('502') || errorMessage.includes('504')) {
			return { shouldRetry: retryCount === 0, newAccount: true };
		}

		// Type 4: Other Errors - Try different account once, then give up
		if (retryCount === 0) {
			return { shouldRetry: true, newAccount: true };
		}

		// Max retries exceeded
		return { shouldRetry: false };
	}

	/**
	 * Switch to a different account (for retries)
	 */
	public async switchAccount(): Promise<boolean> {
		this.selectedAccount = null;
		this.selectedCredentials = null;

		try {
			await this.initializeAuth();
			return this.selectedAccount !== null;
		} catch (error) {
			console.error('Failed to switch account:', error);
			return false;
		}
	}

	/**
	 * Extract status code from error message
	 */
	private extractStatusCode(errorMessage: string): number | null {
		const match = errorMessage.match(/(\d{3})/);
		return match ? parseInt(match[1]) : null;
	}

	/**
	 * Get properly refreshed credentials for health check
	 */
	private async getHealthCheckCredentials(accountId: string): Promise<OAuth2Credentials | null> {
		const rawCredentials = await this.loadAccountCredentials(accountId);
		if (!rawCredentials) {
			return null;
		}

		// Handle expired tokens with refresh (same logic as main selection)
		if (rawCredentials.expiry_date < Date.now()) {
			console.log(`Health check: Account ${accountId} has expired token, attempting refresh...`);
			try {
				return await this.refreshAccountToken(accountId, rawCredentials.refresh_token);
			} catch (refreshError) {
				console.log(`Health check: Refresh failed for ${accountId}, using expired token for test`);
				return rawCredentials; // Return expired token - the test will fail appropriately
			}
		}

		return rawCredentials;
	}

	/**
	 * Get health status of all accounts
	 */
	public async getAccountsHealth(): Promise<AccountHealth[]> {
		const allAccountIds = await this.getAllAccountIds();
		const failedAccounts = await this.getFailedAccounts();
		const results: AccountHealth[] = [];

		for (const accountId of allAccountIds) {
			const credentials = await this.getHealthCheckCredentials(accountId);
			if (!credentials) {
				results.push({
					account: accountId,
					status: 'missing_credentials',
					error: 'No credentials found',
					expiresIn: 'unknown',
					isFailed: failedAccounts.includes(accountId)
				});
				continue;
			}

			const isExpired = credentials.expiry_date < Date.now();
			const expiresIn = isExpired ? 'expired' : `${Math.floor((credentials.expiry_date - Date.now()) / 60000)} min`;

			// Make test chat completion API call to check if account actually works
			let apiStatus = 200;
			let apiError = null;

			try {
				const testResponse = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${credentials.access_token}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						model: 'qwen-coder-plus',
						messages: [{ role: 'user', content: 'hi' }],
						max_tokens: 5
					})
				});
				apiStatus = testResponse.status;
				if (!testResponse.ok) {
					apiError = await testResponse.text();
				}
			} catch (testError) {
				apiStatus = 0;
				apiError = testError instanceof Error ? testError.message : 'Unknown error';
			}

			results.push({
				account: accountId,
				status: apiStatus === 200 ? 'healthy' : apiStatus === 429 ? 'quota_exceeded' : 'error',
				error: apiError,
				expiresIn,
				isFailed: failedAccounts.includes(accountId),
				apiStatus
			});
		}

		return results;
	}
}

export interface AccountHealth {
	account: string;
	status: 'healthy' | 'quota_exceeded' | 'error' | 'missing_credentials';
	error: string | null;
	expiresIn: string;
	isFailed: boolean;
	apiStatus?: number;
}
