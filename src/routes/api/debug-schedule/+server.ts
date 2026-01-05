import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createD1Wrapper, getUserSettings, getHeatingScheduleForDate } from '$lib/server/db';
import { getTodayPrices, getTomorrowPrices, eurMwhToCentKwh } from '$lib/server/elering';
import { getWeatherForDate } from '$lib/server/weather';
import { calculatePriceProportionalOffsets } from '$lib/server/scheduler';

export const GET: RequestHandler = async ({ platform, locals }) => {
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
		const settings = await getUserSettings(db, userId);
		const now = new Date();
		const currentHour = now.getHours();
		const todayStr = now.toISOString().split('T')[0];
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowStr = tomorrow.toISOString().split('T')[0];

		// Get prices
		const todayPrices = await getTodayPrices(db);
		const remainingTodayPrices = todayPrices.filter(p => {
			const hour = new Date(p.timestamp).getHours();
			return hour >= currentHour;
		});
		const tomorrowPrices = await getTomorrowPrices(db);
		const allPrices = [...remainingTodayPrices, ...tomorrowPrices];

		// Get weather
		const [todayWeather, tomorrowWeather] = await Promise.all([
			getWeatherForDate(db, todayStr, settings.weather_location_lat, settings.weather_location_lon),
			getWeatherForDate(db, tomorrowStr, settings.weather_location_lat, settings.weather_location_lon)
		]);
		const allWeather = [...todayWeather, ...tomorrowWeather];

		// Calculate what the algorithm would produce
		const calculatedOffsets = calculatePriceProportionalOffsets(allPrices, allWeather, settings);

		// Get stored schedules
		const todaySchedule = await getHeatingScheduleForDate(db, todayStr, userId);
		const tomorrowSchedule = await getHeatingScheduleForDate(db, tomorrowStr, userId);

		// Calculate price statistics
		const pricesCentKwh = allPrices.map(p => eurMwhToCentKwh(p.price_eur_mwh));
		const sortedPrices = [...pricesCentKwh].sort((a, b) => a - b);
		const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)];
		const minPrice = sortedPrices[0];
		const maxPrice = sortedPrices[sortedPrices.length - 1];
		const priceSpread = maxPrice - minPrice;
		const halfSpread = priceSpread / 2;

		// Find the most expensive hours (top 5)
		const mostExpensive = calculatedOffsets
			.sort((a, b) => b.price_cent_kwh - a.price_cent_kwh)
			.slice(0, 5);

		// Find cheapest hours (bottom 5)
		const cheapest = calculatedOffsets
			.sort((a, b) => a.price_cent_kwh - b.price_cent_kwh)
			.slice(0, 5);

		return json({
			debug: {
				currentTime: now.toISOString(),
				todayStr,
				tomorrowStr,
				currentHour,
				settings: {
					price_sensitivity: settings.price_sensitivity,
					cold_weather_threshold: settings.cold_weather_threshold
				}
			},
			priceStats: {
				totalHours: allPrices.length,
				remainingTodayHours: remainingTodayPrices.length,
				tomorrowHours: tomorrowPrices.length,
				minPrice: minPrice.toFixed(2),
				maxPrice: maxPrice.toFixed(2),
				medianPrice: medianPrice.toFixed(2),
				priceSpread: priceSpread.toFixed(2),
				halfSpread: halfSpread.toFixed(2)
			},
			weatherHours: allWeather.length,
			calculatedOffsets: {
				total: calculatedOffsets.length,
				mostExpensive: mostExpensive.map(h => ({
					date: h.date,
					hour: h.hour,
					price: h.price_cent_kwh.toFixed(2),
					offset: h.planned_offset,
					reason: h.reason
				})),
				cheapest: cheapest.map(h => ({
					date: h.date,
					hour: h.hour,
					price: h.price_cent_kwh.toFixed(2),
					offset: h.planned_offset,
					reason: h.reason
				})),
				allByHour: calculatedOffsets.map(h => ({
					date: h.date,
					hour: h.hour,
					price: h.price_cent_kwh.toFixed(2),
					offset: h.planned_offset
				}))
			},
			storedSchedules: {
				today: todaySchedule.map(h => ({
					hour: h.hour,
					offset: h.planned_offset,
					price: h.price_cent_kwh.toFixed(2)
				})),
				tomorrow: tomorrowSchedule.map(h => ({
					hour: h.hour,
					offset: h.planned_offset,
					price: h.price_cent_kwh.toFixed(2)
				}))
			}
		});
	} catch (err) {
		console.error('Debug endpoint error:', err);
		throw error(500, err instanceof Error ? err.message : 'Unknown error');
	}
};
