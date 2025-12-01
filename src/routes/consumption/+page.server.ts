import type { PageServerLoad } from './$types';
import { createD1Wrapper, getHourlyConsumption } from '$lib/server/db';
import { redirect } from '@sveltejs/kit';
import type { HourlyConsumption } from '$lib/types';

interface DailyConsumption {
	date: string;
	heating_kwh: number;
	cooling_kwh: number;
	dhw_kwh: number;
	total_kwh: number;
	avg_price: number;
	estimated_cost: number;
}

export const load: PageServerLoad = async ({ platform, locals }) => {
	// Require authentication
	if (!locals.user) {
		throw redirect(302, '/login');
	}

	if (!platform?.env?.DB) {
		return {
			error: 'Database not configured',
			dailyData: [],
			hourlyData: [],
			summary: null
		};
	}

	const db = createD1Wrapper(platform.env.DB);

	try {
		// Get last 30 days of consumption data, grouped by day
		// We take the MAX of each day since consumption is cumulative for the day
		const rows = await db.all<{
			date: string;
			heating_kwh: number | null;
			cooling_kwh: number | null;
			dhw_kwh: number | null;
			avg_price: number | null;
		}>(`
			SELECT
				date(timestamp) as date,
				MAX(heating_kwh) as heating_kwh,
				MAX(cooling_kwh) as cooling_kwh,
				MAX(dhw_kwh) as dhw_kwh,
				AVG(price_cent_kwh) as avg_price
			FROM device_state
			WHERE timestamp >= datetime('now', '-30 days')
				AND (heating_kwh IS NOT NULL OR cooling_kwh IS NOT NULL OR dhw_kwh IS NOT NULL)
			GROUP BY date(timestamp)
			ORDER BY date DESC
		`);

		const dailyData: DailyConsumption[] = rows.map(row => {
			const heating = row.heating_kwh ?? 0;
			const cooling = row.cooling_kwh ?? 0;
			const dhw = row.dhw_kwh ?? 0;
			const total = heating + cooling + dhw;
			const avgPrice = row.avg_price ?? 0;
			// Estimated cost in cents
			const estimatedCost = total * avgPrice;

			return {
				date: row.date,
				heating_kwh: heating,
				cooling_kwh: cooling,
				dhw_kwh: dhw,
				total_kwh: total,
				avg_price: avgPrice,
				estimated_cost: estimatedCost
			};
		});

		// Get hourly consumption data (last 7 days)
		const hourlyData: HourlyConsumption[] = await getHourlyConsumption(db, 7);

		// Calculate summary for the period
		const summary = {
			total_heating: dailyData.reduce((sum, d) => sum + d.heating_kwh, 0),
			total_cooling: dailyData.reduce((sum, d) => sum + d.cooling_kwh, 0),
			total_dhw: dailyData.reduce((sum, d) => sum + d.dhw_kwh, 0),
			total_kwh: dailyData.reduce((sum, d) => sum + d.total_kwh, 0),
			total_cost: dailyData.reduce((sum, d) => sum + d.estimated_cost, 0),
			days: dailyData.length
		};

		return {
			dailyData: dailyData.reverse(), // Oldest first for chart
			hourlyData,
			summary,
			error: null
		};
	} catch (error) {
		console.error('Consumption load error:', error);
		return {
			error: error instanceof Error ? error.message : 'Failed to load consumption data',
			dailyData: [],
			hourlyData: [],
			summary: null
		};
	}
};
