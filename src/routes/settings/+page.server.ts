import type { PageServerLoad, Actions } from './$types';
import { createD1Wrapper, getSettings, updateSetting } from '$lib/server/db';
import { isConnected, getAuthorizationUrl } from '$lib/server/daikin';
import { planForDate } from '$lib/server/scheduler';
import { fail, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ platform, url, locals }) => {
	// Require authentication
	if (!locals.user) {
		throw redirect(302, '/login');
	}

	if (!platform?.env?.DB) {
		return {
			error: 'Database not configured',
			settings: null,
			isConnected: false,
			authUrl: null
		};
	}

	const db = createD1Wrapper(platform.env.DB);

	try {
		const [settings, connected] = await Promise.all([getSettings(db), isConnected(db)]);

		// Generate OAuth URL if not connected
		let authUrl: string | null = null;
		if (!connected && platform.env.DAIKIN_CLIENT_ID) {
			const redirectUri = `${url.origin}/auth/callback`;
			const state = crypto.randomUUID();
			authUrl = getAuthorizationUrl(platform.env.DAIKIN_CLIENT_ID, redirectUri, state);
		}

		return {
			settings,
			isConnected: connected,
			authUrl,
			error: null
		};
	} catch (error) {
		console.error('Settings load error:', error);
		return {
			error: error instanceof Error ? error.message : 'Failed to load settings',
			settings: null,
			isConnected: false,
			authUrl: null
		};
	}
};

export const actions: Actions = {
	updateSettings: async ({ request, platform, locals }) => {
		// Require authentication for actions too
		if (!locals.user) {
			return fail(401, { message: 'Not authenticated' });
		}

		if (!platform?.env?.DB) {
			return fail(500, { message: 'Database not configured' });
		}

		const db = createD1Wrapper(platform.env.DB);
		const formData = await request.formData();

		try {
			// Update algorithm settings
			const settingsToUpdate = [
				'price_sensitivity',
				'cold_weather_threshold',
				'planning_hour',
				'low_price_threshold',
				'dhw_min_temp',
				'dhw_target_temp'
			];

			for (const key of settingsToUpdate) {
				const value = formData.get(key);
				if (value !== null) {
					await updateSetting(db, key, value.toString());
				}
			}

			// Handle DHW enabled toggle
			const dhwEnabled = formData.get('dhw_enabled') === 'on';
			await updateSetting(db, 'dhw_enabled', dhwEnabled.toString());

			return { success: true };
		} catch (error) {
			console.error('Settings update error:', error);
			return fail(500, {
				message: error instanceof Error ? error.message : 'Failed to update settings'
			});
		}
	},

	recalculate: async ({ platform, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Not authenticated' });
		}

		if (!platform?.env?.DB) {
			return fail(500, { message: 'Database not configured' });
		}

		const db = createD1Wrapper(platform.env.DB);

		try {
			// planForDate now plans from current hour using all available data
			const result = await planForDate(db);

			if (!result.success) {
				return fail(500, { message: result.message || 'Planning failed' });
			}

			return {
				recalculated: true,
				hoursPlanned: result.heatingHours?.length ?? 0,
				planningMessage: result.message
			};
		} catch (error) {
			console.error('Recalculate error:', error);
			return fail(500, {
				message: error instanceof Error ? error.message : 'Failed to recalculate'
			});
		}
	}
};
