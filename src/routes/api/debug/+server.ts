import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { createD1Wrapper } from '$lib/server/db';
import { getValidAccessToken, getDevices, getDeviceDetails } from '$lib/server/daikin';

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

		return json({
			deviceCount: devices.length,
			devices: deviceDetails
		});
	} catch (e) {
		return json({
			error: e instanceof Error ? e.message : 'Unknown error'
		});
	}
};
