import type { Database } from './db';
import {
	getSettings,
	getUserSettings,
	updateSetting,
	updateUserSetting,
	logControlAction,
	saveDeviceState,
	saveHourlyConsumption,
	saveHeatingSchedule,
	saveDHWSchedule,
	getPlannedOffsetForHour,
	getPlannedDHWTempForHour,
	markHeatingScheduleApplied,
	markDHWScheduleApplied,
	cleanupOldSchedules,
	getAllUsersWithTokens
} from './db';
import {
	getTodayPrices,
	getTomorrowPrices,
	getCurrentHourPrice,
	eurMwhToCentKwh
} from './elering';
import {
	getValidAccessToken,
	getDevices,
	getDeviceDetails,
	parseDeviceState,
	setHeatingTemperature,
	findClimateControlId,
	isWaterBasedSystem,
	findDHWControlId,
	parseDHWState,
	setDHWTemperature,
	parseConsumptionData
} from './daikin';
import { getTomorrowWeather, getWeatherForDate } from './weather';
import type {
	ControlAction,
	ControlDecision,
	Settings,
	PriceData,
	DeviceState,
	DHWState,
	PlannedHeatingHour,
	PlannedDHWHour,
	WeatherForecast
} from '$lib/types';

// DHW control decision
export interface DHWControlDecision {
	action: ControlAction;
	reason: string;
	targetTemperature: number;
	currentPrice: number;
}

// Planning result
export interface DailyPlanningResult {
	success: boolean;
	message: string;
	date: string;
	heatingHours?: PlannedHeatingHour[];
	dhwHours?: PlannedDHWHour[];
}

/**
 * Calculate price-proportional heating offsets for all available hours
 *
 * Algorithm:
 * 1. Calculate price statistics (median, spread) across ALL hours
 * 2. Normalize prices to [-1, +1] range relative to median
 * 3. Apply price sensitivity constant K to get raw offset
 * 4. Apply 50% guarantee: cheapest 50% of hours get offset >= 0
 * 5. Apply cold weather adjustment: reduce penalty when very cold
 * 6. Clamp to valid range [-10, +10]
 *
 * Supports multi-day planning by keying on date+hour
 */
export function calculatePriceProportionalOffsets(
	prices: PriceData[],
	weather: WeatherForecast[],
	settings: Settings
): PlannedHeatingHour[] {
	if (prices.length === 0) {
		return [];
	}

	const K = settings.price_sensitivity; // Default: 7
	const coldThreshold = settings.cold_weather_threshold; // Default: -5

	// Aggregate prices by date+hour (in case we have sub-hourly data)
	// Key: "YYYY-MM-DD-HH" (using UTC to match browser display)
	const hourlyPrices = new Map<string, { prices: number[], date: string, hour: number }>();
	for (const p of prices) {
		const d = new Date(p.timestamp);
		const dateStr = d.toISOString().split('T')[0];
		const hour = d.getUTCHours();
		const key = `${dateStr}-${hour.toString().padStart(2, '0')}`;
		const priceCentKwh = eurMwhToCentKwh(p.price_eur_mwh);
		if (!hourlyPrices.has(key)) {
			hourlyPrices.set(key, { prices: [], date: dateStr, hour });
		}
		hourlyPrices.get(key)!.prices.push(priceCentKwh);
	}

	// Calculate average price per date+hour
	const pricesCentKwh = Array.from(hourlyPrices.entries()).map(([key, data]) => ({
		key,
		date: data.date,
		hour: data.hour,
		price: data.prices.reduce((a, b) => a + b, 0) / data.prices.length
	}));

	// Calculate price statistics
	const priceValues = pricesCentKwh.map(p => p.price);
	const sortedPrices = [...priceValues].sort((a, b) => a - b);
	const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)];
	const minPrice = sortedPrices[0];
	const maxPrice = sortedPrices[sortedPrices.length - 1];
	const priceSpread = maxPrice - minPrice;

	// Avoid division by zero if all prices are the same
	const halfSpread = priceSpread > 0 ? priceSpread / 2 : 1;

	// Create weather lookup by date+hour key (using UTC to match price keys)
	const weatherByKey = new Map<string, number>();
	for (const w of weather) {
		const d = new Date(w.timestamp);
		const dateStr = d.toISOString().split('T')[0];
		const hour = d.getUTCHours();
		const key = `${dateStr}-${hour.toString().padStart(2, '0')}`;
		weatherByKey.set(key, w.temperature_2m);
	}

	// Calculate raw offsets
	const rawOffsets = pricesCentKwh.map(p => {
		// Normalized price deviation: -1 (cheapest) to +1 (most expensive)
		const deviation = (p.price - medianPrice) / halfSpread;
		const normalizedDeviation = Math.max(-1, Math.min(1, deviation));

		// Base offset: cheap = positive (more heating), expensive = negative
		const rawOffset = -K * normalizedDeviation;

		return {
			key: p.key,
			date: p.date,
			hour: p.hour,
			price: p.price,
			rawOffset
		};
	});

	// Sort by price to identify cheapest 50%
	const sortedByPrice = [...rawOffsets].sort((a, b) => a.price - b.price);
	const cheapestHalfKeys = new Set(
		sortedByPrice.slice(0, Math.ceil(sortedByPrice.length / 2)).map(h => h.key)
	);

	// Apply 50% guarantee and cold weather adjustment
	const plannedHours: PlannedHeatingHour[] = rawOffsets.map(h => {
		let offset = h.rawOffset;
		const outdoorTemp = weatherByKey.get(h.key) ?? null;
		const reasons: string[] = [];

		// 50% guarantee: cheapest half always gets offset >= 0
		if (cheapestHalfKeys.has(h.key) && offset < 0) {
			offset = 0;
			reasons.push('50% garantii');
		}

		// Cold weather adjustment: reduce penalty when very cold
		if (outdoorTemp !== null && outdoorTemp < coldThreshold && offset < 0) {
			// At coldThreshold: no adjustment
			// At coldThreshold - 10 (e.g., -15°C if threshold is -5°C): 50% reduction
			const coldFactor = Math.min(1, (coldThreshold - outdoorTemp) / 10);
			const adjustment = 0.5 * coldFactor;
			offset = offset * (1 - adjustment);
			reasons.push(`külm ilm (${outdoorTemp.toFixed(0)}°C)`);
		}

		// Clamp to valid range and round
		const finalOffset = Math.round(Math.max(-10, Math.min(10, offset)));

		// Build reason string
		const pricePosition = h.price <= sortedPrices[Math.floor(sortedPrices.length * 0.25)]
			? 'odav'
			: h.price >= sortedPrices[Math.floor(sortedPrices.length * 0.75)]
				? 'kallis'
				: 'keskmine';

		const baseReason = `Hind ${h.price.toFixed(1)} s/kWh (${pricePosition})`;
		const tempInfo = outdoorTemp !== null ? `, välistemperatuur ${outdoorTemp.toFixed(0)}°C` : '';
		const extras = reasons.length > 0 ? ` [${reasons.join(', ')}]` : '';

		return {
			date: h.date,
			hour: h.hour,
			planned_offset: finalOffset,
			outdoor_temp_forecast: outdoorTemp,
			price_cent_kwh: h.price,
			reason: `${baseReason}${tempInfo}${extras}`
		};
	});

	// Sort by date then hour
	return plannedHours.sort((a, b) => {
		const dateCompare = (a.date || '').localeCompare(b.date || '');
		if (dateCompare !== 0) return dateCompare;
		return a.hour - b.hour;
	});
}

/**
 * Calculate price-proportional DHW temperatures for all available hours
 *
 * Similar to heating, but:
 * - Uses absolute temperatures (30-55°C) instead of offsets
 * - Less price sensitive (K_DHW = 3 vs K = 7)
 * - Same 50% guarantee applies
 *
 * Supports multi-day planning by keying on date+hour
 */
export function calculateDHWProportionalTemps(
	prices: PriceData[],
	settings: Settings
): PlannedDHWHour[] {
	if (prices.length === 0) {
		return [];
	}

	const K_DHW = 3; // Less sensitive than heating
	const minTemp = settings.dhw_min_temp; // 30°C
	const maxTemp = settings.dhw_target_temp; // 55°C
	const midTemp = (minTemp + maxTemp) / 2; // 42.5°C
	const tempRange = maxTemp - minTemp; // 25°C

	// Aggregate prices by date+hour (in case we have sub-hourly data)
	// Key: "YYYY-MM-DD-HH" (using UTC to match browser display)
	const hourlyPrices = new Map<string, { prices: number[], date: string, hour: number }>();
	for (const p of prices) {
		const d = new Date(p.timestamp);
		const dateStr = d.toISOString().split('T')[0];
		const hour = d.getUTCHours();
		const key = `${dateStr}-${hour.toString().padStart(2, '0')}`;
		const priceCentKwh = eurMwhToCentKwh(p.price_eur_mwh);
		if (!hourlyPrices.has(key)) {
			hourlyPrices.set(key, { prices: [], date: dateStr, hour });
		}
		hourlyPrices.get(key)!.prices.push(priceCentKwh);
	}

	// Calculate average price per date+hour
	const pricesCentKwh = Array.from(hourlyPrices.entries()).map(([key, data]) => ({
		key,
		date: data.date,
		hour: data.hour,
		price: data.prices.reduce((a, b) => a + b, 0) / data.prices.length
	}));

	// Calculate price statistics
	const priceValues = pricesCentKwh.map(p => p.price);
	const sortedPrices = [...priceValues].sort((a, b) => a - b);
	const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)];
	const minPrice = sortedPrices[0];
	const maxPrice = sortedPrices[sortedPrices.length - 1];
	const priceSpread = maxPrice - minPrice;
	const halfSpread = priceSpread > 0 ? priceSpread / 2 : 1;

	// Calculate raw temperatures
	const rawTemps = pricesCentKwh.map(p => {
		// Normalized price deviation: -1 (cheapest) to +1 (most expensive)
		const deviation = (p.price - medianPrice) / halfSpread;
		const normalizedDeviation = Math.max(-1, Math.min(1, deviation));

		// Temperature offset from middle: cheap = higher temp, expensive = lower
		// Scale K_DHW to temperature range
		const tempOffset = -K_DHW * normalizedDeviation * (tempRange / 20);
		const rawTemp = midTemp + tempOffset;

		return {
			key: p.key,
			date: p.date,
			hour: p.hour,
			price: p.price,
			rawTemp
		};
	});

	// Sort by price to identify cheapest 50%
	const sortedByPrice = [...rawTemps].sort((a, b) => a.price - b.price);
	const cheapestHalfKeys = new Set(
		sortedByPrice.slice(0, Math.ceil(sortedByPrice.length / 2)).map(h => h.key)
	);

	// Apply 50% guarantee
	const plannedHours: PlannedDHWHour[] = rawTemps.map(h => {
		let temp = h.rawTemp;
		const reasons: string[] = [];

		// 50% guarantee: cheapest half always gets at least midTemp
		if (cheapestHalfKeys.has(h.key) && temp < midTemp) {
			temp = midTemp;
			reasons.push('50% garantii');
		}

		// Clamp to valid range and round
		const finalTemp = Math.round(Math.max(minTemp, Math.min(maxTemp, temp)));

		// Build reason string
		const pricePosition = h.price <= sortedPrices[Math.floor(sortedPrices.length * 0.25)]
			? 'odav'
			: h.price >= sortedPrices[Math.floor(sortedPrices.length * 0.75)]
				? 'kallis'
				: 'keskmine';

		const baseReason = `Hind ${h.price.toFixed(1)} s/kWh (${pricePosition})`;
		const extras = reasons.length > 0 ? ` [${reasons.join(', ')}]` : '';

		return {
			date: h.date,
			hour: h.hour,
			planned_temp: finalTemp,
			price_cent_kwh: h.price,
			reason: `${baseReason}${extras}`
		};
	});

	// Sort by date then hour
	return plannedHours.sort((a, b) => {
		const dateCompare = (a.date || '').localeCompare(b.date || '');
		if (dateCompare !== 0) return dateCompare;
		return a.hour - b.hour;
	});
}

/**
 * Execute daily planning - plans heating/DHW for all available hours
 *
 * Combines remaining hours today + all of tomorrow for optimal price spread.
 * This way, expensive evening hours today won't get boost if tomorrow morning is cheap.
 */
export async function executeDailyPlanning(
	db: Database,
	settings?: Settings,
	userId?: string
): Promise<DailyPlanningResult> {
	try {
		const effectiveSettings = settings || (userId ? await getUserSettings(db, userId) : await getSettings(db));

		// Get current time info (use UTC since price timestamps are in UTC)
		const now = new Date();
		const currentHour = now.getUTCHours();
		const todayStr = now.toISOString().split('T')[0];
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowStr = tomorrow.toISOString().split('T')[0];

		// Get today's prices (will filter to remaining hours)
		const todayPrices = await getTodayPrices(db);
		const remainingTodayPrices = todayPrices.filter(p => {
			const hour = new Date(p.timestamp).getUTCHours();
			return hour >= currentHour;
		});

		// Get tomorrow's prices (may not be available yet)
		const tomorrowPrices = await getTomorrowPrices(db);

		// Combine all available prices
		const allPrices = [...remainingTodayPrices, ...tomorrowPrices];

		// Need at least some data to plan
		if (allPrices.length < 6) {
			return {
				success: false,
				message: `Pole piisavalt hinnaandmeid (${allPrices.length} tundi). Vaja vähemalt 6 tundi.`,
				date: todayStr
			};
		}

		// Get weather for both days
		const [todayWeather, tomorrowWeather] = await Promise.all([
			getWeatherForDate(db, todayStr, effectiveSettings.weather_location_lat, effectiveSettings.weather_location_lon),
			getWeatherForDate(db, tomorrowStr, effectiveSettings.weather_location_lat, effectiveSettings.weather_location_lon)
		]);
		const allWeather = [...todayWeather, ...tomorrowWeather];

		// Calculate heating schedule for ALL hours
		const heatingHours = calculatePriceProportionalOffsets(
			allPrices,
			allWeather,
			effectiveSettings
		);

		// Calculate DHW schedule if enabled
		let dhwHours: PlannedDHWHour[] = [];
		if (effectiveSettings.dhw_enabled) {
			dhwHours = calculateDHWProportionalTemps(allPrices, effectiveSettings);
		}

		// Group hours by date for saving
		const heatingByDate = new Map<string, PlannedHeatingHour[]>();
		for (const h of heatingHours) {
			const date = h.date || todayStr;
			if (!heatingByDate.has(date)) {
				heatingByDate.set(date, []);
			}
			heatingByDate.get(date)!.push(h);
		}

		const dhwByDate = new Map<string, PlannedDHWHour[]>();
		for (const h of dhwHours) {
			const date = h.date || todayStr;
			if (!dhwByDate.has(date)) {
				dhwByDate.set(date, []);
			}
			dhwByDate.get(date)!.push(h);
		}

		// Save schedules to database (per date)
		for (const [date, hours] of heatingByDate) {
			await saveHeatingSchedule(db, date, hours, userId);
		}
		for (const [date, hours] of dhwByDate) {
			await saveDHWSchedule(db, date, hours, userId);
		}

		// Clean up old schedules
		await cleanupOldSchedules(db, userId);

		// Build summary
		const heatingOffsets = heatingHours.map(h => h.planned_offset);
		const avgOffset = heatingOffsets.length > 0
			? heatingOffsets.reduce((a, b) => a + b, 0) / heatingOffsets.length
			: 0;
		const boostHours = heatingHours.filter(h => h.planned_offset >= 5).length;
		const reduceHours = heatingHours.filter(h => h.planned_offset <= -5).length;

		// Count hours per day
		const todayCount = heatingByDate.get(todayStr)?.length || 0;
		const tomorrowCount = heatingByDate.get(tomorrowStr)?.length || 0;

		const message = `Plaan loodud: täna ${todayCount}h + homme ${tomorrowCount}h. ` +
			`Küte: keskmine nihe ${avgOffset.toFixed(1)}, boost ${boostHours}h, reduce ${reduceHours}h. ` +
			(dhwHours.length > 0 ? `Boiler: ${dhwHours.length}h planeeritud.` : '');

		return {
			success: true,
			message,
			date: `${todayStr}+${tomorrowStr}`,
			heatingHours,
			dhwHours
		};
	} catch (error) {
		console.error('Daily planning error:', error);
		return {
			success: false,
			message: error instanceof Error ? error.message : 'Unknown error',
			date: ''
		};
	}
}

/**
 * Legacy: Find the cheapest hour within a time window (used as fallback)
 */
function findCheapestHourInWindow(
	prices: PriceData[],
	windowHours: number,
	currentTimestamp: string
): { timestamp: string; price: number } | null {
	const now = new Date(currentTimestamp).getTime();
	const windowEnd = now + windowHours * 60 * 60 * 1000;

	const windowPrices = prices.filter(p => {
		const t = new Date(p.timestamp).getTime();
		return t >= now && t < windowEnd;
	});

	if (windowPrices.length === 0) return null;

	const cheapest = windowPrices.reduce((min, p) =>
		p.price_eur_mwh < min.price_eur_mwh ? p : min
	);

	return {
		timestamp: cheapest.timestamp,
		price: eurMwhToCentKwh(cheapest.price_eur_mwh)
	};
}

/**
 * Fallback heating action when no schedule exists
 */
function calculateFallbackHeatingAction(
	currentPriceCentKwh: number,
	currentTimestamp: string,
	allPrices: PriceData[],
	settings: Settings,
	waterTemp: number | null
): ControlDecision {
	const reasons: string[] = [];
	let action: ControlAction = 'reduce';
	let targetOffset = -10;

	const minWaterTemp = settings.min_water_temp;
	const windowHours = settings.best_price_window_hours;

	// Safety check
	if (waterTemp !== null && waterTemp <= minWaterTemp) {
		return {
			action: 'boost',
			reason: `Vee temp ${waterTemp}°C miinimumi ${minWaterTemp}°C juures - hädakütmine`,
			targetTemperature: 10,
			currentPrice: currentPriceCentKwh
		};
	}

	// Find cheapest hour in window
	const cheapestInWindow = findCheapestHourInWindow(allPrices, windowHours, currentTimestamp);

	if (cheapestInWindow) {
		const currentHourStart = new Date(currentTimestamp).getTime();
		const cheapestHourStart = new Date(cheapestInWindow.timestamp).getTime();

		if (Math.abs(currentHourStart - cheapestHourStart) < 60 * 60 * 1000) {
			action = 'boost';
			targetOffset = 10;
			reasons.push(`Praegune tund on odavaim ${windowHours}h aknas (${cheapestInWindow.price.toFixed(1)} s/kWh) [fallback]`);
		} else {
			action = 'reduce';
			targetOffset = -10;
			const hoursUntilCheapest = Math.round((cheapestHourStart - currentHourStart) / (60 * 60 * 1000));
			reasons.push(`Ootan odavamat hinda ${hoursUntilCheapest}h pärast [fallback]`);
		}
	} else {
		if (currentPriceCentKwh < settings.low_price_threshold) {
			action = 'boost';
			targetOffset = 10;
			reasons.push(`Hind ${currentPriceCentKwh.toFixed(1)} s/kWh alla piiri [fallback]`);
		} else {
			action = 'reduce';
			targetOffset = -10;
			reasons.push(`Hinnaandmed puuduvad [fallback]`);
		}
	}

	return {
		action,
		reason: reasons.join('; '),
		targetTemperature: targetOffset,
		currentPrice: currentPriceCentKwh
	};
}

/**
 * Execute the scheduled control task
 * If userId is provided, uses user-scoped settings and tokens
 */
export async function executeScheduledTask(
	db: Database,
	clientId: string,
	clientSecret: string,
	userId?: string
): Promise<{
	success: boolean;
	message: string;
	decision?: ControlDecision;
	deviceState?: DeviceState;
	planningResult?: DailyPlanningResult;
}> {
	try {
		const settings = userId ? await getUserSettings(db, userId) : await getSettings(db);
		const now = new Date();
		const localHour = now.getHours();  // For user-facing planning_hour setting
		const currentHour = now.getUTCHours();  // For schedule lookups (stored in UTC)
		const todayStr = now.toISOString().split('T')[0];

		// Check if we should run daily planning (using local time since planning_hour is user-set)
		// Run if: it's the planning hour OR a previous planning attempt failed
		let planningResult: DailyPlanningResult | undefined;
		const shouldPlan = localHour === settings.planning_hour || settings.planning_needs_retry;

		if (shouldPlan) {
			planningResult = await executeDailyPlanning(db, settings, userId);
			console.log('Daily planning result:', planningResult.message);

			// Update retry flag based on success/failure
			if (planningResult.success) {
				if (userId) {
					await updateUserSetting(db, userId, 'planning_needs_retry', 'false');
				} else {
					await updateSetting(db, 'planning_needs_retry', 'false');
				}
			} else {
				if (userId) {
					await updateUserSetting(db, userId, 'planning_needs_retry', 'true');
				} else {
					await updateSetting(db, 'planning_needs_retry', 'true');
				}
				console.log('Planning failed, will retry on next cron run');
			}
		}

		// Get current price
		const currentPriceEurMwh = await getCurrentHourPrice(db);
		if (currentPriceEurMwh === null) {
			return {
				success: false,
				message: 'Could not get current electricity price',
				planningResult
			};
		}

		const currentPriceCentKwh = eurMwhToCentKwh(currentPriceEurMwh);

		// Get access token (user-scoped if userId provided)
		const accessToken = await getValidAccessToken(db, clientId, clientSecret, userId);
		if (!accessToken) {
			return {
				success: false,
				message: 'Not connected to Daikin (no valid access token)',
				planningResult
			};
		}

		// Get devices
		const devices = await getDevices(accessToken);
		if (devices.length === 0) {
			return {
				success: false,
				message: 'No Daikin devices found',
				planningResult
			};
		}

		// Get the first device
		const device = await getDeviceDetails(accessToken, devices[0].id);
		const deviceState = parseDeviceState(device);
		const climateControlId = findClimateControlId(device);
		const isWaterBased = isWaterBasedSystem(device);

		// Parse DHW state
		const dhwControlId = findDHWControlId(device);
		const dhwState = parseDHWState(device);

		// Parse consumption data
		const consumptionData = parseConsumptionData(device);

		if (!isWaterBased) {
			return {
				success: false,
				message: 'This smart heating strategy only supports water-based systems (Altherma)',
				planningResult
			};
		}

		// Try to get planned offset for current hour
		let decision: ControlDecision;
		const plannedOffset = await getPlannedOffsetForHour(db, todayStr, currentHour, userId);

		if (plannedOffset !== null) {
			// Use pre-planned schedule
			const action: ControlAction = plannedOffset >= 5 ? 'boost' : plannedOffset <= -5 ? 'reduce' : 'normal';
			decision = {
				action,
				reason: `Planeeritud nihe: ${plannedOffset} (hind ${currentPriceCentKwh.toFixed(1)} s/kWh)`,
				targetTemperature: plannedOffset,
				currentPrice: currentPriceCentKwh
			};

			// Mark as applied
			await markHeatingScheduleApplied(db, todayStr, currentHour, userId);
		} else {
			// Fallback: no schedule exists, use legacy algorithm
			const todayPrices = await getTodayPrices(db);
			const tomorrowPrices = await getTomorrowPrices(db);
			const allPrices = [...todayPrices, ...tomorrowPrices];

			const currentTimestamp = `${todayStr}T${currentHour.toString().padStart(2, '0')}:00:00.000Z`;

			decision = calculateFallbackHeatingAction(
				currentPriceCentKwh,
				currentTimestamp,
				allPrices,
				settings,
				deviceState.water_temp
			);
		}

		// Handle DHW
		let dhwDecision: DHWControlDecision | null = null;
		if (settings.dhw_enabled && dhwControlId) {
			const plannedDhwTemp = await getPlannedDHWTempForHour(db, todayStr, currentHour, userId);

			if (plannedDhwTemp !== null) {
				const action: ControlAction = plannedDhwTemp >= 50 ? 'boost' : plannedDhwTemp <= 35 ? 'reduce' : 'normal';
				dhwDecision = {
					action,
					reason: `Planeeritud temp: ${plannedDhwTemp}°C`,
					targetTemperature: plannedDhwTemp,
					currentPrice: currentPriceCentKwh
				};
				await markDHWScheduleApplied(db, todayStr, currentHour, userId);
			} else {
				// Fallback DHW logic
				const tankTemp = dhwState?.tank_temp ?? null;
				const minTemp = settings.dhw_min_temp;
				const boostTemp = settings.dhw_target_temp;

				if (tankTemp !== null && tankTemp <= minTemp) {
					dhwDecision = {
						action: 'boost',
						reason: `Boileri temp ${tankTemp}°C miinimumi ${minTemp}°C juures [fallback]`,
						targetTemperature: boostTemp,
						currentPrice: currentPriceCentKwh
					};
				} else if (currentPriceCentKwh < settings.low_price_threshold) {
					dhwDecision = {
						action: 'boost',
						reason: `Madal hind ${currentPriceCentKwh.toFixed(1)} s/kWh [fallback]`,
						targetTemperature: boostTemp,
						currentPrice: currentPriceCentKwh
					};
				} else {
					dhwDecision = {
						action: 'reduce',
						reason: `Tavaline hind [fallback]`,
						targetTemperature: minTemp,
						currentPrice: currentPriceCentKwh
					};
				}
			}
		}

		// Save current state
		const stateToSave: DeviceState = {
			...deviceState,
			timestamp: new Date().toISOString(),
			price_cent_kwh: currentPriceCentKwh,
			action_taken: decision.action,
			dhw_tank_temp: dhwState?.tank_temp ?? null,
			dhw_target_temp: dhwState?.target_temp ?? null,
			dhw_action: dhwDecision?.action ?? undefined,
			heating_kwh: consumptionData.heating_today_kwh,
			cooling_kwh: consumptionData.cooling_today_kwh,
			dhw_kwh: consumptionData.dhw_today_kwh
		};
		await saveDeviceState(db, stateToSave, userId);
		await saveHourlyConsumption(db, consumptionData, userId);

		const messages: string[] = [];

		// Apply heating temperature change
		if (climateControlId && deviceState.target_offset !== decision.targetTemperature) {
			await setHeatingTemperature(
				accessToken,
				device.id,
				climateControlId,
				decision.targetTemperature,
				true
			);

			await logControlAction(db, {
				timestamp: new Date().toISOString(),
				action: decision.action,
				reason: decision.reason,
				price_eur_mwh: currentPriceEurMwh,
				old_target_temp: deviceState.target_offset,
				new_target_temp: decision.targetTemperature
			}, userId);

			messages.push(`Küte: nihe ${deviceState.target_offset} -> ${decision.targetTemperature} (${decision.action})`);
		} else {
			messages.push(`Küte: muutust pole (nihe ${decision.targetTemperature})`);
		}

		// Apply DHW temperature change
		if (dhwDecision && dhwControlId) {
			const currentDhwTarget = dhwState?.target_temp ?? 0;
			if (currentDhwTarget !== dhwDecision.targetTemperature) {
				await setDHWTemperature(
					accessToken,
					device.id,
					dhwControlId,
					dhwDecision.targetTemperature
				);

				await logControlAction(db, {
					timestamp: new Date().toISOString(),
					action: `dhw_${dhwDecision.action}`,
					reason: dhwDecision.reason,
					price_eur_mwh: currentPriceEurMwh,
					old_target_temp: currentDhwTarget,
					new_target_temp: dhwDecision.targetTemperature
				}, userId);

				messages.push(`Boiler: siht ${currentDhwTarget}°C -> ${dhwDecision.targetTemperature}°C (${dhwDecision.action})`);
			} else {
				messages.push(`Boiler: muutust pole (siht ${dhwDecision.targetTemperature}°C)`);
			}
		}

		return {
			success: true,
			message: messages.join('; '),
			decision,
			deviceState: stateToSave,
			planningResult
		};
	} catch (error) {
		console.error('Scheduled task error:', error);
		return {
			success: false,
			message: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

/**
 * Preview what action would be taken without executing
 */
export async function previewControlAction(
	db: Database,
	userId?: string
): Promise<ControlDecision | null> {
	try {
		const settings = userId ? await getUserSettings(db, userId) : await getSettings(db);
		const now = new Date();
		const currentHour = now.getUTCHours();
		const todayStr = now.toISOString().split('T')[0];

		const currentPriceEurMwh = await getCurrentHourPrice(db);
		if (currentPriceEurMwh === null) {
			return null;
		}

		const currentPriceCentKwh = eurMwhToCentKwh(currentPriceEurMwh);

		// Try to get planned offset
		const plannedOffset = await getPlannedOffsetForHour(db, todayStr, currentHour, userId);

		if (plannedOffset !== null) {
			const action: ControlAction = plannedOffset >= 5 ? 'boost' : plannedOffset <= -5 ? 'reduce' : 'normal';
			return {
				action,
				reason: `Planeeritud nihe: ${plannedOffset}`,
				targetTemperature: plannedOffset,
				currentPrice: currentPriceCentKwh
			};
		}

		// Fallback
		const todayPrices = await getTodayPrices(db);
		const tomorrowPrices = await getTomorrowPrices(db);
		const allPrices = [...todayPrices, ...tomorrowPrices];

		const currentTimestamp = `${todayStr}T${currentHour.toString().padStart(2, '0')}:00:00.000Z`;

		return calculateFallbackHeatingAction(
			currentPriceCentKwh,
			currentTimestamp,
			allPrices,
			settings,
			null
		);
	} catch {
		return null;
	}
}

/**
 * Force run daily planning (for manual trigger or testing)
 */
export async function forceRunDailyPlanning(
	db: Database,
	userId?: string
): Promise<DailyPlanningResult> {
	return executeDailyPlanning(db, undefined, userId);
}

/**
 * Plan for available hours (wrapper for executeDailyPlanning)
 *
 * This function plans from the current hour onwards using all available price data.
 * The dateStr parameter is kept for backwards compatibility but is ignored -
 * planning always starts from now.
 */
export async function planForDate(
	db: Database,
	_dateStr?: string,
	userId?: string
): Promise<DailyPlanningResult> {
	// Just use executeDailyPlanning which now handles multi-day planning
	return executeDailyPlanning(db, undefined, userId);
}

/**
 * Alias for planForDate - plans from current hour using all available data
 */
export async function planAvailableHours(
	db: Database,
	userId?: string
): Promise<DailyPlanningResult> {
	return executeDailyPlanning(db, undefined, userId);
}

/**
 * Get the current day's schedule for display
 */
export async function getTodaySchedule(
	db: Database,
	userId?: string
): Promise<{ heating: PlannedHeatingHour[]; dhw: PlannedDHWHour[] } | null> {
	const todayStr = new Date().toISOString().split('T')[0];

	const { getHeatingScheduleForDate, getDHWScheduleForDate } = await import('./db');

	const heating = await getHeatingScheduleForDate(db, todayStr, userId);
	const dhw = await getDHWScheduleForDate(db, todayStr, userId);

	if (heating.length === 0 && dhw.length === 0) {
		return null;
	}

	return { heating, dhw };
}

// Multi-user scheduler result types
export interface UserSchedulerResult {
	userId: string;
	success: boolean;
	message: string;
	decision?: ControlDecision;
}

export interface MultiUserSchedulerResult {
	success: boolean;
	usersProcessed: number;
	results: UserSchedulerResult[];
}

/**
 * Execute scheduled task for ALL users with valid tokens
 * Used by the cron job to process all users
 */
export async function executeScheduledTaskForAllUsers(
	db: Database,
	clientId: string,
	clientSecret: string
): Promise<MultiUserSchedulerResult> {
	const usersWithTokens = await getAllUsersWithTokens(db);
	const results: UserSchedulerResult[] = [];

	console.log(`Running scheduler for ${usersWithTokens.length} user(s)`);

	for (const { userId } of usersWithTokens) {
		try {
			console.log(`Processing user: ${userId}`);
			const result = await executeScheduledTask(db, clientId, clientSecret, userId);
			results.push({
				userId,
				success: result.success,
				message: result.message,
				decision: result.decision
			});
		} catch (error) {
			console.error(`Scheduler error for user ${userId}:`, error);
			results.push({
				userId,
				success: false,
				message: error instanceof Error ? error.message : 'Unknown error'
			});
		}
	}

	return {
		success: results.every(r => r.success),
		usersProcessed: results.length,
		results
	};
}
