import type { PageServerLoad } from './$types';
import { createD1Wrapper, getLatestDeviceState, getSettings } from '$lib/server/db';
import { getHourlyPricesWithAnalysis, getCurrentHourPrice, eurMwhToCentKwh } from '$lib/server/elering';
import { isConnected } from '$lib/server/daikin';
import { previewControlAction } from '$lib/server/scheduler';

export const load: PageServerLoad = async ({ platform, locals }) => {
	const isAuthenticated = !!locals.user;

	if (!platform?.env?.DB) {
		return {
			error: 'Database not configured',
			prices: [],
			deviceState: null,
			currentPrice: null,
			settings: null,
			nextAction: null,
			isConnected: false,
			isAuthenticated
		};
	}

	const db = createD1Wrapper(platform.env.DB);

	try {
		// Always fetch prices (public data)
		const [prices, currentPriceEurMwh] = await Promise.all([
			getHourlyPricesWithAnalysis(db, true),
			getCurrentHourPrice(db)
		]);

		// Only fetch sensitive data if authenticated
		let deviceState = null;
		let settings = null;
		let connected = false;
		let nextAction = null;

		if (isAuthenticated) {
			[deviceState, settings, connected, nextAction] = await Promise.all([
				getLatestDeviceState(db),
				getSettings(db),
				isConnected(db),
				previewControlAction(db)
			]);
		}

		return {
			prices,
			deviceState,
			currentPrice: currentPriceEurMwh !== null ? eurMwhToCentKwh(currentPriceEurMwh) : null,
			settings,
			nextAction,
			isConnected: connected,
			isAuthenticated,
			error: null
		};
	} catch (error) {
		console.error('Dashboard load error:', error);
		return {
			error: error instanceof Error ? error.message : 'Failed to load dashboard data',
			prices: [],
			deviceState: null,
			currentPrice: null,
			settings: null,
			nextAction: null,
			isConnected: false,
			isAuthenticated
		};
	}
};
