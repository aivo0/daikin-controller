import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { createD1Wrapper, getRecentControlLogs } from '$lib/server/db';

export const load: PageServerLoad = async ({ platform, locals }) => {
	// Require authentication
	if (!locals.user) {
		throw redirect(302, '/login');
	}

	if (!platform?.env?.DB) {
		return {
			error: 'Database not configured',
			logs: []
		};
	}

	const db = createD1Wrapper(platform.env.DB);

	try {
		const logs = await getRecentControlLogs(db, 100);

		return {
			logs,
			error: null
		};
	} catch (error) {
		console.error('History load error:', error);
		return {
			error: error instanceof Error ? error.message : 'Failed to load history',
			logs: []
		};
	}
};
