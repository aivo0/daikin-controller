import type { WeatherForecast } from '$lib/types';
import type { Database } from './db';

const OPEN_METEO_API_URL = 'https://api.open-meteo.com/v1/forecast';

// Open-Meteo API response structure
interface OpenMeteoResponse {
	hourly: {
		time: string[];
		temperature_2m: number[];
	};
}

/**
 * Fetch weather forecast from Open-Meteo API
 * @param latitude Latitude (default: Luige alevik, Estonia)
 * @param longitude Longitude (default: Luige alevik, Estonia)
 * @param days Number of days to fetch (1-7)
 */
export async function fetchWeatherForecast(
	latitude: number = 59.3,
	longitude: number = 24.7,
	days: number = 2
): Promise<WeatherForecast[]> {
	const params = new URLSearchParams({
		latitude: latitude.toString(),
		longitude: longitude.toString(),
		hourly: 'temperature_2m',
		forecast_days: Math.min(days, 7).toString(),
		timezone: 'Europe/Tallinn'
	});

	const response = await fetch(`${OPEN_METEO_API_URL}?${params}`);

	if (!response.ok) {
		throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`);
	}

	const data: OpenMeteoResponse = await response.json();

	if (!data.hourly?.time || !data.hourly?.temperature_2m) {
		throw new Error('Invalid response from Open-Meteo API');
	}

	return data.hourly.time.map((time, i) => ({
		timestamp: new Date(time).toISOString(),
		temperature_2m: data.hourly.temperature_2m[i]
	}));
}

/**
 * Save weather forecast to database cache
 */
export async function saveWeatherForecast(
	db: Database,
	forecasts: WeatherForecast[]
): Promise<void> {
	for (const forecast of forecasts) {
		await db.run(
			`INSERT INTO weather_forecast (timestamp, temperature_2m, fetched_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(timestamp) DO UPDATE SET
         temperature_2m = excluded.temperature_2m,
         fetched_at = excluded.fetched_at`,
			forecast.timestamp,
			forecast.temperature_2m
		);
	}
}

/**
 * Get weather forecast from database for a date range
 */
export async function getWeatherForRange(
	db: Database,
	start: string,
	end: string
): Promise<WeatherForecast[]> {
	return db.all<WeatherForecast>(
		'SELECT timestamp, temperature_2m FROM weather_forecast WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp',
		start,
		end
	);
}

/**
 * Get weather forecast for a specific date (24 hours)
 * Will fetch from API if not in cache
 */
export async function getWeatherForDate(
	db: Database,
	date: string,
	latitude: number = 59.3,
	longitude: number = 24.7
): Promise<WeatherForecast[]> {
	// Parse date and create range
	const startOfDay = new Date(date);
	startOfDay.setHours(0, 0, 0, 0);
	const endOfDay = new Date(startOfDay);
	endOfDay.setDate(endOfDay.getDate() + 1);

	// Try to get from cache first
	let forecasts = await getWeatherForRange(
		db,
		startOfDay.toISOString(),
		endOfDay.toISOString()
	);

	// If we don't have all 24 hours, fetch from API
	if (forecasts.length < 24) {
		try {
			const freshForecasts = await fetchWeatherForecast(latitude, longitude, 2);
			await saveWeatherForecast(db, freshForecasts);

			// Get the forecasts for the requested date from the fresh data
			forecasts = freshForecasts.filter(f => {
				const t = new Date(f.timestamp);
				return t >= startOfDay && t < endOfDay;
			});
		} catch (error) {
			console.error('Failed to fetch weather forecast:', error);
			// Return what we have from cache
		}
	}

	return forecasts;
}

/**
 * Get tomorrow's weather forecast
 * Will fetch from API if not in cache
 */
export async function getTomorrowWeather(
	db: Database,
	latitude: number = 59.3,
	longitude: number = 24.7
): Promise<WeatherForecast[]> {
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	const dateStr = tomorrow.toISOString().split('T')[0];

	return getWeatherForDate(db, dateStr, latitude, longitude);
}

/**
 * Get weather forecast for the current hour
 */
export async function getCurrentWeather(
	db: Database,
	latitude: number = 59.3,
	longitude: number = 24.7
): Promise<number | null> {
	const now = new Date();
	const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

	const forecast = await db.get<WeatherForecast>(
		'SELECT timestamp, temperature_2m FROM weather_forecast WHERE timestamp = ?',
		hourStart.toISOString()
	);

	if (forecast) {
		return forecast.temperature_2m;
	}

	// Try to fetch and cache
	try {
		const freshForecasts = await fetchWeatherForecast(latitude, longitude, 2);
		await saveWeatherForecast(db, freshForecasts);

		const match = freshForecasts.find(f => f.timestamp === hourStart.toISOString());
		return match?.temperature_2m ?? null;
	} catch {
		return null;
	}
}

/**
 * Clean up old weather forecasts (older than 7 days)
 */
export async function cleanupOldWeatherData(db: Database): Promise<void> {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - 7);

	await db.run(
		'DELETE FROM weather_forecast WHERE timestamp < ?',
		cutoff.toISOString()
	);
}
