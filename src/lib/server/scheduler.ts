import type { Database } from './db';
import {
	getSettings,
	logControlAction,
	saveDeviceState,
	saveHourlyConsumption,
	saveHeatingSchedule,
	saveDHWSchedule,
	getPlannedOffsetForHour,
	getPlannedDHWTempForHour,
	markHeatingScheduleApplied,
	markDHWScheduleApplied,
	cleanupOldSchedules
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
 * Calculate price-proportional heating offsets for a full day
 *
 * Algorithm:
 * 1. Calculate price statistics (median, spread)
 * 2. Normalize prices to [-1, +1] range relative to median
 * 3. Apply price sensitivity constant K to get raw offset
 * 4. Apply 50% guarantee: cheapest 50% of hours get offset >= 0
 * 5. Apply cold weather adjustment: reduce penalty when very cold
 * 6. Clamp to valid range [-10, +10]
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

	// Aggregate prices by hour (in case we have sub-hourly data)
	const hourlyPrices = new Map<number, number[]>();
	for (const p of prices) {
		const hour = new Date(p.timestamp).getHours();
		const priceCentKwh = eurMwhToCentKwh(p.price_eur_mwh);
		if (!hourlyPrices.has(hour)) {
			hourlyPrices.set(hour, []);
		}
		hourlyPrices.get(hour)!.push(priceCentKwh);
	}

	// Calculate average price per hour
	const pricesCentKwh = Array.from(hourlyPrices.entries()).map(([hour, prices]) => ({
		hour,
		price: prices.reduce((a, b) => a + b, 0) / prices.length
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

	// Create weather lookup by hour
	const weatherByHour = new Map<number, number>();
	for (const w of weather) {
		const hour = new Date(w.timestamp).getHours();
		weatherByHour.set(hour, w.temperature_2m);
	}

	// Calculate raw offsets
	const rawOffsets = pricesCentKwh.map(p => {
		// Normalized price deviation: -1 (cheapest) to +1 (most expensive)
		const deviation = (p.price - medianPrice) / halfSpread;
		const normalizedDeviation = Math.max(-1, Math.min(1, deviation));

		// Base offset: cheap = positive (more heating), expensive = negative
		const rawOffset = -K * normalizedDeviation;

		return {
			hour: p.hour,
			price: p.price,
			rawOffset
		};
	});

	// Sort by price to identify cheapest 50%
	const sortedByPrice = [...rawOffsets].sort((a, b) => a.price - b.price);
	const cheapestHalfHours = new Set(
		sortedByPrice.slice(0, Math.ceil(sortedByPrice.length / 2)).map(h => h.hour)
	);

	// Apply 50% guarantee and cold weather adjustment
	const plannedHours: PlannedHeatingHour[] = rawOffsets.map(h => {
		let offset = h.rawOffset;
		const outdoorTemp = weatherByHour.get(h.hour) ?? null;
		const reasons: string[] = [];

		// 50% guarantee: cheapest half always gets offset >= 0
		if (cheapestHalfHours.has(h.hour) && offset < 0) {
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
			hour: h.hour,
			planned_offset: finalOffset,
			outdoor_temp_forecast: outdoorTemp,
			price_cent_kwh: h.price,
			reason: `${baseReason}${tempInfo}${extras}`
		};
	});

	// Sort by hour
	return plannedHours.sort((a, b) => a.hour - b.hour);
}

/**
 * Calculate price-proportional DHW temperatures for a full day
 *
 * Similar to heating, but:
 * - Uses absolute temperatures (30-55°C) instead of offsets
 * - Less price sensitive (K_DHW = 3 vs K = 7)
 * - Same 50% guarantee applies
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

	// Aggregate prices by hour (in case we have sub-hourly data)
	const hourlyPrices = new Map<number, number[]>();
	for (const p of prices) {
		const hour = new Date(p.timestamp).getHours();
		const priceCentKwh = eurMwhToCentKwh(p.price_eur_mwh);
		if (!hourlyPrices.has(hour)) {
			hourlyPrices.set(hour, []);
		}
		hourlyPrices.get(hour)!.push(priceCentKwh);
	}

	// Calculate average price per hour
	const pricesCentKwh = Array.from(hourlyPrices.entries()).map(([hour, prices]) => ({
		hour,
		price: prices.reduce((a, b) => a + b, 0) / prices.length
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
			hour: p.hour,
			price: p.price,
			rawTemp
		};
	});

	// Sort by price to identify cheapest 50%
	const sortedByPrice = [...rawTemps].sort((a, b) => a.price - b.price);
	const cheapestHalfHours = new Set(
		sortedByPrice.slice(0, Math.ceil(sortedByPrice.length / 2)).map(h => h.hour)
	);

	// Apply 50% guarantee
	const plannedHours: PlannedDHWHour[] = rawTemps.map(h => {
		let temp = h.rawTemp;
		const reasons: string[] = [];

		// 50% guarantee: cheapest half always gets at least midTemp
		if (cheapestHalfHours.has(h.hour) && temp < midTemp) {
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
			hour: h.hour,
			planned_temp: finalTemp,
			price_cent_kwh: h.price,
			reason: `${baseReason}${extras}`
		};
	});

	// Sort by hour
	return plannedHours.sort((a, b) => a.hour - b.hour);
}

/**
 * Execute daily planning - called once per day around planning_hour (default 15:00)
 * Plans the heating and DHW schedule for the next day
 */
export async function executeDailyPlanning(
	db: Database,
	settings?: Settings
): Promise<DailyPlanningResult> {
	try {
		const effectiveSettings = settings || await getSettings(db);

		// Get tomorrow's date
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowStr = tomorrow.toISOString().split('T')[0];

		// Get tomorrow's prices
		const tomorrowPrices = await getTomorrowPrices(db);
		if (tomorrowPrices.length < 24) {
			return {
				success: false,
				message: `Homse hinnad pole veel saadaval (${tomorrowPrices.length}/24 tundi)`,
				date: tomorrowStr
			};
		}

		// Get tomorrow's weather forecast
		const tomorrowWeather = await getTomorrowWeather(
			db,
			effectiveSettings.weather_location_lat,
			effectiveSettings.weather_location_lon
		);

		// Calculate heating schedule
		const heatingHours = calculatePriceProportionalOffsets(
			tomorrowPrices,
			tomorrowWeather,
			effectiveSettings
		);

		// Calculate DHW schedule if enabled
		let dhwHours: PlannedDHWHour[] = [];
		if (effectiveSettings.dhw_enabled) {
			dhwHours = calculateDHWProportionalTemps(tomorrowPrices, effectiveSettings);
		}

		// Save schedules to database
		await saveHeatingSchedule(db, tomorrowStr, heatingHours);
		if (dhwHours.length > 0) {
			await saveDHWSchedule(db, tomorrowStr, dhwHours);
		}

		// Clean up old schedules
		await cleanupOldSchedules(db);

		// Build summary
		const heatingOffsets = heatingHours.map(h => h.planned_offset);
		const avgOffset = heatingOffsets.reduce((a, b) => a + b, 0) / heatingOffsets.length;
		const boostHours = heatingHours.filter(h => h.planned_offset >= 5).length;
		const reduceHours = heatingHours.filter(h => h.planned_offset <= -5).length;

		const message = `Plaan loodud: ${tomorrowStr}. ` +
			`Küte: keskmine nihe ${avgOffset.toFixed(1)}, boost ${boostHours}h, reduce ${reduceHours}h. ` +
			(dhwHours.length > 0 ? `Boiler: ${dhwHours.length}h planeeritud.` : '');

		return {
			success: true,
			message,
			date: tomorrowStr,
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
 */
export async function executeScheduledTask(
	db: Database,
	clientId: string,
	clientSecret: string
): Promise<{
	success: boolean;
	message: string;
	decision?: ControlDecision;
	deviceState?: DeviceState;
	planningResult?: DailyPlanningResult;
}> {
	try {
		const settings = await getSettings(db);
		const now = new Date();
		const currentHour = now.getHours();
		const todayStr = now.toISOString().split('T')[0];

		// Check if we should run daily planning
		let planningResult: DailyPlanningResult | undefined;
		if (currentHour === settings.planning_hour) {
			planningResult = await executeDailyPlanning(db, settings);
			console.log('Daily planning result:', planningResult.message);
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

		// Get access token
		const accessToken = await getValidAccessToken(db, clientId, clientSecret);
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
		const plannedOffset = await getPlannedOffsetForHour(db, todayStr, currentHour);

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
			await markHeatingScheduleApplied(db, todayStr, currentHour);
		} else {
			// Fallback: no schedule exists, use legacy algorithm
			const todayPrices = await getTodayPrices(db);
			const tomorrowPrices = await getTomorrowPrices(db);
			const allPrices = [...todayPrices, ...tomorrowPrices];

			const currentTimestamp = new Date(
				now.getFullYear(),
				now.getMonth(),
				now.getDate(),
				currentHour
			).toISOString();

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
			const plannedDhwTemp = await getPlannedDHWTempForHour(db, todayStr, currentHour);

			if (plannedDhwTemp !== null) {
				const action: ControlAction = plannedDhwTemp >= 50 ? 'boost' : plannedDhwTemp <= 35 ? 'reduce' : 'normal';
				dhwDecision = {
					action,
					reason: `Planeeritud temp: ${plannedDhwTemp}°C`,
					targetTemperature: plannedDhwTemp,
					currentPrice: currentPriceCentKwh
				};
				await markDHWScheduleApplied(db, todayStr, currentHour);
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
		await saveDeviceState(db, stateToSave);
		await saveHourlyConsumption(db, consumptionData);

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
			});

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
				});

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
	db: Database
): Promise<ControlDecision | null> {
	try {
		const settings = await getSettings(db);
		const now = new Date();
		const currentHour = now.getHours();
		const todayStr = now.toISOString().split('T')[0];

		const currentPriceEurMwh = await getCurrentHourPrice(db);
		if (currentPriceEurMwh === null) {
			return null;
		}

		const currentPriceCentKwh = eurMwhToCentKwh(currentPriceEurMwh);

		// Try to get planned offset
		const plannedOffset = await getPlannedOffsetForHour(db, todayStr, currentHour);

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

		const currentTimestamp = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
			currentHour
		).toISOString();

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
	db: Database
): Promise<DailyPlanningResult> {
	return executeDailyPlanning(db);
}

/**
 * Plan for a specific date (used to backfill today's plan)
 */
export async function planForDate(
	db: Database,
	dateStr: string
): Promise<DailyPlanningResult> {
	try {
		const settings = await getSettings(db);

		// Get prices for the specified date
		const startOfDay = new Date(dateStr);
		startOfDay.setHours(0, 0, 0, 0);
		const endOfDay = new Date(startOfDay);
		endOfDay.setDate(endOfDay.getDate() + 1);

		// Import getPricesForRange
		const { getPricesForRange } = await import('./db');
		let prices = await getPricesForRange(db, startOfDay.toISOString(), endOfDay.toISOString());

		// If we don't have prices, try to fetch today's prices
		if (prices.length < 24) {
			const todayPrices = await getTodayPrices(db);
			// Filter to the requested date
			prices = todayPrices.filter(p => {
				const pDate = new Date(p.timestamp).toISOString().split('T')[0];
				return pDate === dateStr;
			});
		}

		if (prices.length === 0) {
			return {
				success: false,
				message: `Hinnad puuduvad kuupäeva ${dateStr} jaoks`,
				date: dateStr
			};
		}

		// Get weather forecast for the date
		const weather = await getWeatherForDate(
			db,
			dateStr,
			settings.weather_location_lat,
			settings.weather_location_lon
		);

		// Calculate heating schedule
		const heatingHours = calculatePriceProportionalOffsets(prices, weather, settings);

		// Calculate DHW schedule if enabled
		let dhwHours: PlannedDHWHour[] = [];
		if (settings.dhw_enabled) {
			dhwHours = calculateDHWProportionalTemps(prices, settings);
		}

		// Save schedules to database
		await saveHeatingSchedule(db, dateStr, heatingHours);
		if (dhwHours.length > 0) {
			await saveDHWSchedule(db, dateStr, dhwHours);
		}

		// Build summary
		const heatingOffsets = heatingHours.map(h => h.planned_offset);
		const avgOffset = heatingOffsets.length > 0
			? heatingOffsets.reduce((a, b) => a + b, 0) / heatingOffsets.length
			: 0;
		const boostHours = heatingHours.filter(h => h.planned_offset >= 5).length;
		const reduceHours = heatingHours.filter(h => h.planned_offset <= -5).length;

		const message = `Plaan loodud: ${dateStr}. ` +
			`Küte: keskmine nihe ${avgOffset.toFixed(1)}, boost ${boostHours}h, reduce ${reduceHours}h. ` +
			(dhwHours.length > 0 ? `Boiler: ${dhwHours.length}h planeeritud.` : '');

		return {
			success: true,
			message,
			date: dateStr,
			heatingHours,
			dhwHours
		};
	} catch (error) {
		console.error('Plan for date error:', error);
		return {
			success: false,
			message: error instanceof Error ? error.message : 'Unknown error',
			date: dateStr
		};
	}
}

/**
 * Get the current day's schedule for display
 */
export async function getTodaySchedule(
	db: Database
): Promise<{ heating: PlannedHeatingHour[]; dhw: PlannedDHWHour[] } | null> {
	const todayStr = new Date().toISOString().split('T')[0];

	const { getHeatingScheduleForDate, getDHWScheduleForDate } = await import('./db');

	const heating = await getHeatingScheduleForDate(db, todayStr);
	const dhw = await getDHWScheduleForDate(db, todayStr);

	if (heating.length === 0 && dhw.length === 0) {
		return null;
	}

	return { heating, dhw };
}
