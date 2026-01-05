import type { PageServerLoad } from './$types';
import { createD1Wrapper, getLatestDeviceState, getUserSettings, getHeatingScheduleForDate } from '$lib/server/db';
import { getHourlyPricesWithAnalysis, getCurrentHourPrice, eurMwhToCentKwh } from '$lib/server/elering';
import { isConnected } from '$lib/server/daikin';
import { previewControlAction } from '$lib/server/scheduler';
import type { PlannedHeatingHour } from '$lib/types';

export const load: PageServerLoad = async ({ platform, locals }) => {
	const isAuthenticated = !!locals.user;
	const userId = locals.user?.id;

	if (!platform?.env?.DB) {
		return {
			error: 'Database not configured',
			prices: [],
			deviceState: null,
			currentPrice: null,
			settings: null,
			nextAction: null,
			heatingSchedule: [] as PlannedHeatingHour[],
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
		let heatingSchedule: PlannedHeatingHour[] = [];

		if (isAuthenticated && userId) {
			// Get today and tomorrow dates
			const now = new Date();
			const todayStr = now.toISOString().split('T')[0];
			const tomorrow = new Date(now);
			tomorrow.setDate(tomorrow.getDate() + 1);
			const tomorrowStr = tomorrow.toISOString().split('T')[0];

			const [deviceStateResult, settingsResult, connectedResult, nextActionResult, todaySchedule, tomorrowSchedule] = await Promise.all([
				getLatestDeviceState(db, userId),
				getUserSettings(db, userId),
				isConnected(db, userId),
				previewControlAction(db, userId),
				getHeatingScheduleForDate(db, todayStr, userId),
				getHeatingScheduleForDate(db, tomorrowStr, userId)
			]);

			deviceState = deviceStateResult;
			settings = settingsResult;
			connected = connectedResult;
			nextAction = nextActionResult;

			// Combine schedules with date prefix for proper timestamp matching
			heatingSchedule = [
				...todaySchedule.map(h => ({ ...h, date: todayStr })),
				...tomorrowSchedule.map(h => ({ ...h, date: tomorrowStr }))
			];
		}

		return {
			prices,
			deviceState,
			currentPrice: currentPriceEurMwh !== null ? eurMwhToCentKwh(currentPriceEurMwh) : null,
			settings,
			nextAction,
			heatingSchedule,
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
			heatingSchedule: [] as PlannedHeatingHour[],
			isConnected: false,
			isAuthenticated
		};
	}
};
