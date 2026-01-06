import type { RequestHandler } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { createD1Wrapper, saveUserTokens } from '$lib/server/db';
import { exchangeCodeForTokens } from '$lib/server/daikin';
import { createAuth } from '$lib/server/auth';
import { executeScheduledTask } from '$lib/server/scheduler';

export const GET: RequestHandler = async ({ url, platform, request }) => {
	const code = url.searchParams.get('code');
	const errorParam = url.searchParams.get('error');
	const errorDescription = url.searchParams.get('error_description');

	if (errorParam) {
		throw error(400, `OAuth error: ${errorParam} - ${errorDescription}`);
	}

	if (!code) {
		throw error(400, 'No authorization code received');
	}

	if (!platform?.env?.DB) {
		throw error(500, 'Database not configured');
	}

	// Get current user from session
	const auth = createAuth(platform.env);
	const session = await auth.api.getSession({ headers: request.headers });

	if (!session?.user?.id) {
		throw error(401, 'Must be logged in to connect Daikin account');
	}

	const userId = session.user.id;

	const clientId = platform.env.DAIKIN_CLIENT_ID;
	const clientSecret = platform.env.DAIKIN_CLIENT_SECRET;

	if (!clientId || !clientSecret) {
		throw error(500, 'Daikin API credentials not configured');
	}

	const redirectUri = `${url.origin}/auth/callback`;

	try {
		console.log('OAuth callback received, exchanging code for user:', userId);
		console.log('Redirect URI:', redirectUri);

		const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);

		const db = createD1Wrapper(platform.env.DB);
		// Save tokens associated with the current user
		await saveUserTokens(db, userId, tokens);

		// Try to fetch device data immediately so user sees data on first dashboard load
		try {
			console.log('Fetching initial device data for user:', userId);
			await executeScheduledTask(db, clientId, clientSecret, userId);
		} catch (e) {
			// Don't fail OAuth if initial fetch fails - cron will pick up later
			console.error('Initial device fetch failed (will retry on cron):', e);
		}

		return new Response(null, {
			status: 303,
			headers: { Location: '/settings?connected=true' }
		});
	} catch (e) {
		console.error('Token exchange error:', e);

		// Show detailed error to help debug
		const errorMessage = e instanceof Error ? e.message : 'Failed to exchange authorization code';
		throw error(500, errorMessage);
	}
};
