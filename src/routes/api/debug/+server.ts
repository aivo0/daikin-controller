import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { createD1Wrapper } from '$lib/server/db';
import { getValidAccessToken, getDevices, getDeviceDetails, parseConsumptionData } from '$lib/server/daikin';
import { planForDate, getTodaySchedule } from '$lib/server/scheduler';

export const GET: RequestHandler = async ({ platform, locals }) => {
	// Require authentication
	if (!locals.user) {
		throw error(401, 'Not authenticated');
	}

	if (!platform?.env?.DB) {
		throw error(500, 'Database not configured');
	}

	const clientId = platform.env.DAIKIN_CLIENT_ID;
	const clientSecret = platform.env.DAIKIN_CLIENT_SECRET;

	if (!clientId || !clientSecret) {
		return json({ error: 'Daikin API credentials not configured' });
	}

	const db = createD1Wrapper(platform.env.DB);

	try {
		const accessToken = await getValidAccessToken(db, clientId, clientSecret);
		if (!accessToken) {
			return json({ error: 'Not connected to Daikin' });
		}

		const devices = await getDevices(accessToken);

		// Get full details of each device
		const deviceDetails = await Promise.all(
			devices.map(d => getDeviceDetails(accessToken, d.id))
		);

		// Extract consumption data for debugging
		const consumptionDebug = deviceDetails.map(device => {
			const consumption = parseConsumptionData(device);
			const mpConsumption = device.managementPoints.map(mp => ({
				type: mp.managementPointType,
				embeddedId: mp.embeddedId,
				hasConsumptionData: !!mp.consumptionData,
				consumptionData: mp.consumptionData
			}));
			return {
				deviceId: device.id,
				parsedConsumption: consumption,
				managementPointConsumption: mpConsumption
			};
		});

		return json({
			deviceCount: devices.length,
			consumptionDebug,
			devices: deviceDetails
		});
	} catch (e) {
		return json({
			error: e instanceof Error ? e.message : 'Unknown error'
		});
	}
};

// POST handler to trigger planning for a specific date
export const POST: RequestHandler = async ({ platform, locals, request }) => {
	// Require authentication
	if (!locals.user) {
		throw error(401, 'Not authenticated');
	}

	const userId = locals.user.id;

	if (!platform?.env?.DB) {
		throw error(500, 'Database not configured');
	}

	const db = createD1Wrapper(platform.env.DB);

	try {
		const body = await request.json();
		const action = body.action;

		if (action === 'planToday') {
			const today = new Date().toISOString().split('T')[0];
			const result = await planForDate(db, today, userId);
			return json({
				action: 'planToday',
				result
			});
		}

		if (action === 'planDate' && body.date) {
			const result = await planForDate(db, body.date, userId);
			return json({
				action: 'planDate',
				result
			});
		}

		if (action === 'getSchedule') {
			const schedule = await getTodaySchedule(db, userId);
			return json({
				action: 'getSchedule',
				schedule
			});
		}

		return json({ error: 'Unknown action. Supported: planToday, planDate, getSchedule' });
	} catch (e) {
		return json({
			error: e instanceof Error ? e.message : 'Unknown error'
		});
	}
};
