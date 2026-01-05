import type { Handle } from '@sveltejs/kit';
import { createAuth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';

export const handle: Handle = async ({ event, resolve }) => {
	// Skip auth for cron endpoint (uses secret token)
	if (event.url.pathname === '/api/cron') {
		return resolve(event);
	}

	// Check if platform/env is available
	if (!event.platform?.env?.DB || !event.platform?.env?.BETTER_AUTH_SECRET) {
		// During build or when env is not available, skip auth
		event.locals.user = null;
		event.locals.session = null;
		return resolve(event);
	}

	const auth = createAuth(event.platform.env);

	// Get session - any authenticated user is allowed
	try {
		const session = await auth.api.getSession({
			headers: event.request.headers
		});

		if (session && session.user) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		} else {
			event.locals.session = null;
			event.locals.user = null;
		}
	} catch {
		event.locals.session = null;
		event.locals.user = null;
	}

	// Handle auth API routes
	return svelteKitHandler({ event, resolve, auth });
};
