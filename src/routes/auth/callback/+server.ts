import type { RequestHandler } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { createD1Wrapper, saveTokens } from '$lib/server/db';
import { exchangeCodeForTokens } from '$lib/server/daikin';

export const GET: RequestHandler = async ({ url, platform }) => {
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

	const clientId = platform.env.DAIKIN_CLIENT_ID;
	const clientSecret = platform.env.DAIKIN_CLIENT_SECRET;

	if (!clientId || !clientSecret) {
		throw error(500, 'Daikin API credentials not configured');
	}

	const redirectUri = `${url.origin}/auth/callback`;

	try {
		console.log('OAuth callback received, exchanging code...');
		console.log('Redirect URI:', redirectUri);

		const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);

		const db = createD1Wrapper(platform.env.DB);
		await saveTokens(db, tokens);

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
