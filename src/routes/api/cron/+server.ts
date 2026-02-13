import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { createD1Wrapper } from '$lib/server/db';
import { executeScheduledTaskForAllUsers } from '$lib/server/scheduler';

// This endpoint is called by Cloudflare Cron Triggers every hour
// You can also call it manually for testing
// Now processes ALL users with valid Daikin tokens

export const GET: RequestHandler = async ({ platform, request }) => {
	// Check for cron secret or internal call
	const cronSecret = request.headers.get('x-cron-secret');
	const expectedSecret = platform?.env?.CRON_SECRET;

	// Allow calls without secret for development, but require it in production
	if (expectedSecret && cronSecret !== expectedSecret) {
		throw error(403, 'Invalid cron secret');
	}

	if (!platform?.env?.DB) {
		throw error(500, 'Database not configured');
	}

	const clientId = platform.env.DAIKIN_CLIENT_ID;
	const clientSecret = platform.env.DAIKIN_CLIENT_SECRET;

	if (!clientId || !clientSecret) {
		return json({
			success: false,
			message: 'Daikin API credentials not configured',
			timestamp: new Date().toISOString()
		});
	}

	const db = createD1Wrapper(platform.env.DB);

	try {
		// Process all users with valid tokens
		const result = await executeScheduledTaskForAllUsers(db, clientId, clientSecret);

		return json({
			...result,
			timestamp: new Date().toISOString()
		});
	} catch (e) {
		console.error('Cron task error:', e);
		return json(
			{
				success: false,
				message: e instanceof Error ? e.message : 'Unknown error',
				timestamp: new Date().toISOString()
			},
			{ status: 500 }
		);
	}
};

// Also support POST for webhook-based triggers
export const POST: RequestHandler = GET;
