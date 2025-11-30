import type { PriceData, HourlyPrice, EleringPriceResponse } from '$lib/types';
import type { Database } from './db';
import { savePrices, getPricesForRange } from './db';

const ELERING_API_URL = 'https://dashboard.elering.ee/api/nps/price';

/**
 * Fetch electricity prices from Elering API
 */
export async function fetchEleringPrices(start: Date, end: Date): Promise<PriceData[]> {
	const params = new URLSearchParams({
		start: start.toISOString(),
		end: end.toISOString()
	});

	const response = await fetch(`${ELERING_API_URL}?${params}`);

	if (!response.ok) {
		throw new Error(`Elering API error: ${response.status} ${response.statusText}`);
	}

	const data: EleringPriceResponse = await response.json();

	if (!data.success || !data.data?.ee) {
		throw new Error('Invalid response from Elering API');
	}

	return data.data.ee.map((item) => ({
		timestamp: new Date(item.timestamp * 1000).toISOString(),
		price_eur_mwh: item.price
	}));
}

/**
 * Get today's prices (from DB cache or API)
 */
export async function getTodayPrices(db: Database): Promise<PriceData[]> {
	const now = new Date();
	const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const endOfDay = new Date(startOfDay);
	endOfDay.setDate(endOfDay.getDate() + 1);

	// Try to get from cache first
	let prices = await getPricesForRange(db, startOfDay.toISOString(), endOfDay.toISOString());

	// If we don't have all hours, fetch from API
	if (prices.length < 24) {
		const freshPrices = await fetchEleringPrices(startOfDay, endOfDay);
		await savePrices(db, freshPrices);
		prices = freshPrices;
	}

	return prices;
}

/**
 * Get tomorrow's prices (available after ~14:00 EET)
 */
export async function getTomorrowPrices(db: Database): Promise<PriceData[]> {
	const now = new Date();
	const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	const endOfTomorrow = new Date(startOfTomorrow);
	endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);

	// Try to get from cache first
	let prices = await getPricesForRange(
		db,
		startOfTomorrow.toISOString(),
		endOfTomorrow.toISOString()
	);

	// If we don't have tomorrow's prices and it's after 14:00 EET, try to fetch
	const hour = now.getUTCHours() + 2; // EET is UTC+2 (simplified, doesn't account for DST)
	if (prices.length < 24 && hour >= 14) {
		try {
			const freshPrices = await fetchEleringPrices(startOfTomorrow, endOfTomorrow);
			if (freshPrices.length > 0) {
				await savePrices(db, freshPrices);
				prices = freshPrices;
			}
		} catch {
			// Tomorrow's prices might not be available yet
		}
	}

	return prices;
}

/**
 * Get current hour's price
 */
export async function getCurrentHourPrice(db: Database): Promise<number | null> {
	const now = new Date();
	const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

	const prices = await getPricesForRange(
		db,
		hourStart.toISOString(),
		new Date(hourStart.getTime() + 3600000).toISOString()
	);

	if (prices.length === 0) {
		// Try to fetch today's prices
		await getTodayPrices(db);
		const freshPrices = await getPricesForRange(
			db,
			hourStart.toISOString(),
			new Date(hourStart.getTime() + 3600000).toISOString()
		);
		return freshPrices[0]?.price_eur_mwh ?? null;
	}

	return prices[0].price_eur_mwh;
}

/**
 * Convert EUR/MWh to c/kWh (cents per kilowatt-hour)
 */
export function eurMwhToCentKwh(eurMwh: number): number {
	return eurMwh / 10; // 1 EUR/MWh = 0.1 c/kWh
}

/**
 * Get prices formatted for display with analysis
 */
export async function getHourlyPricesWithAnalysis(
	db: Database,
	includeNextDay: boolean = false
): Promise<HourlyPrice[]> {
	const todayPrices = await getTodayPrices(db);
	let allPrices = [...todayPrices];

	if (includeNextDay) {
		const tomorrowPrices = await getTomorrowPrices(db);
		allPrices = [...allPrices, ...tomorrowPrices];
	}

	if (allPrices.length === 0) {
		return [];
	}

	// Calculate thresholds based on distribution
	const priceValues = allPrices.map((p) => p.price_eur_mwh);
	const sortedPrices = [...priceValues].sort((a, b) => a - b);
	const cheapThreshold = sortedPrices[Math.floor(sortedPrices.length * 0.25)];
	const expensiveThreshold = sortedPrices[Math.floor(sortedPrices.length * 0.75)];

	const now = new Date();
	const currentHourStart = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
		now.getHours()
	).toISOString();

	return allPrices.map((p) => {
		const date = new Date(p.timestamp);
		return {
			hour: date.getHours(),
			price: eurMwhToCentKwh(p.price_eur_mwh),
			timestamp: p.timestamp,
			isCheap: p.price_eur_mwh <= cheapThreshold,
			isExpensive: p.price_eur_mwh >= expensiveThreshold,
			isCurrent: p.timestamp === currentHourStart
		};
	});
}

/**
 * Find the N cheapest hours in a time range
 */
export function findCheapestHours(prices: PriceData[], n: number): PriceData[] {
	return [...prices].sort((a, b) => a.price_eur_mwh - b.price_eur_mwh).slice(0, n);
}

/**
 * Find the N most expensive hours in a time range
 */
export function findMostExpensiveHours(prices: PriceData[], n: number): PriceData[] {
	return [...prices].sort((a, b) => b.price_eur_mwh - a.price_eur_mwh).slice(0, n);
}
