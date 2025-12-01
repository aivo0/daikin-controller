import type { Database } from './db';
import { getSettings, logControlAction, saveDeviceState, saveHourlyConsumption } from './db';
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
import type { ControlAction, ControlDecision, Settings, PriceData, DeviceState, DHWState } from '$lib/types';

// DHW control decision
export interface DHWControlDecision {
	action: ControlAction;
	reason: string;
	targetTemperature: number;
	currentPrice: number;
}

/**
 * Find the cheapest hour within a time window
 */
function findCheapestHourInWindow(
	prices: PriceData[],
	windowHours: number,
	currentTimestamp: string
): { timestamp: string; price: number } | null {
	const now = new Date(currentTimestamp).getTime();
	const windowEnd = now + windowHours * 60 * 60 * 1000;

	// Filter prices within the window
	const windowPrices = prices.filter(p => {
		const t = new Date(p.timestamp).getTime();
		return t >= now && t < windowEnd;
	});

	if (windowPrices.length === 0) return null;

	// Find the cheapest
	const cheapest = windowPrices.reduce((min, p) =>
		p.price_eur_mwh < min.price_eur_mwh ? p : min
	);

	return {
		timestamp: cheapest.timestamp,
		price: eurMwhToCentKwh(cheapest.price_eur_mwh)
	};
}

/**
 * Smart heating control decision
 * Strategy:
 * 1. If water temp <= min_water_temp (20°C) → BOOST immediately (safety)
 * 2. If current hour is cheapest in 6h window → BOOST to target (32°C)
 * 3. Otherwise → REDUCE (let temp drift down to save money)
 */
export function calculateSmartHeatingAction(
	currentPriceCentKwh: number,
	currentTimestamp: string,
	allPrices: PriceData[],
	settings: Settings,
	waterTemp: number | null
): ControlDecision {
	const reasons: string[] = [];
	let action: ControlAction = 'reduce'; // Default: save energy
	let targetOffset = -10; // Maximum reduction by default

	const minWaterTemp = settings.min_water_temp;
	const windowHours = settings.best_price_window_hours;

	// Safety check: if water temp is too low, boost immediately
	if (waterTemp !== null && waterTemp <= minWaterTemp) {
		action = 'boost';
		targetOffset = 10; // Maximum boost
		reasons.push(`Vee temp ${waterTemp}°C miinimumi ${minWaterTemp}°C juures - hädakütmine`);
		return {
			action,
			reason: reasons.join('; '),
			targetTemperature: targetOffset,
			currentPrice: currentPriceCentKwh
		};
	}

	// Find cheapest hour in the next N hours
	const cheapestInWindow = findCheapestHourInWindow(allPrices, windowHours, currentTimestamp);

	if (cheapestInWindow) {
		const currentHourStart = new Date(currentTimestamp).getTime();
		const cheapestHourStart = new Date(cheapestInWindow.timestamp).getTime();

		// Check if current hour IS the cheapest hour
		if (Math.abs(currentHourStart - cheapestHourStart) < 60 * 60 * 1000) {
			action = 'boost';
			targetOffset = 10; // Maximum boost to heat up
			reasons.push(`Praegune tund on odavaim ${windowHours}h aknas (${cheapestInWindow.price.toFixed(1)} s/kWh)`);
		} else {
			// Not the cheapest hour - reduce/wait
			action = 'reduce';
			targetOffset = -10; // Maximum reduction
			const hoursUntilCheapest = Math.round((cheapestHourStart - currentHourStart) / (60 * 60 * 1000));
			reasons.push(`Ootan odavamat hinda ${hoursUntilCheapest}h pärast (${cheapestInWindow.price.toFixed(1)} s/kWh vs praegu ${currentPriceCentKwh.toFixed(1)} s/kWh)`);

			if (waterTemp !== null) {
				reasons.push(`Vee temp: ${waterTemp}°C (min: ${minWaterTemp}°C)`);
			}
		}
	} else {
		// No price data for window - use threshold strategy
		if (currentPriceCentKwh < settings.low_price_threshold) {
			action = 'boost';
			targetOffset = 10;
			reasons.push(`Hind ${currentPriceCentKwh.toFixed(1)} s/kWh alla piiri ${settings.low_price_threshold}`);
		} else {
			action = 'reduce';
			targetOffset = -10;
			reasons.push(`Hinnaandmed puuduvad, praegune hind ${currentPriceCentKwh.toFixed(1)} s/kWh`);
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
 * Smart DHW (sooja vee boiler) control decision
 * Strategy:
 * 1. If tank temp ≤ min_temp (42°C) → BOOST immediately (safety/legionella)
 * 2. If current hour is cheapest in 6h window → BOOST to target (55°C)
 * 3. Otherwise → REDUCE to min_temp (let temp drift down)
 */
export function calculateDHWAction(
	currentPriceCentKwh: number,
	currentTimestamp: string,
	allPrices: PriceData[],
	settings: Settings,
	dhwState: DHWState | null
): DHWControlDecision {
	const reasons: string[] = [];
	let action: ControlAction = 'reduce';
	let targetTemp = settings.dhw_min_temp; // Default: minimum (42°C)

	const minTemp = settings.dhw_min_temp;
	const boostTemp = settings.dhw_target_temp;
	const windowHours = settings.best_price_window_hours;
	const tankTemp = dhwState?.tank_temp ?? null;

	// Safety check: if tank temp is too low, boost immediately
	if (tankTemp !== null && tankTemp <= minTemp) {
		action = 'boost';
		targetTemp = boostTemp;
		reasons.push(`Boileri temp ${tankTemp}°C miinimumi ${minTemp}°C juures - soojendamine`);
		return {
			action,
			reason: reasons.join('; '),
			targetTemperature: targetTemp,
			currentPrice: currentPriceCentKwh
		};
	}

	// Find cheapest hour in the next N hours
	const cheapestInWindow = findCheapestHourInWindow(allPrices, windowHours, currentTimestamp);

	if (cheapestInWindow) {
		const currentHourStart = new Date(currentTimestamp).getTime();
		const cheapestHourStart = new Date(cheapestInWindow.timestamp).getTime();

		// Check if current hour IS the cheapest hour
		if (Math.abs(currentHourStart - cheapestHourStart) < 60 * 60 * 1000) {
			action = 'boost';
			targetTemp = boostTemp;
			reasons.push(`Praegune tund on odavaim ${windowHours}h aknas (${cheapestInWindow.price.toFixed(1)} s/kWh) - boileri soojendamine`);
		} else {
			// Not the cheapest hour - reduce/wait
			action = 'reduce';
			targetTemp = minTemp;
			const hoursUntilCheapest = Math.round((cheapestHourStart - currentHourStart) / (60 * 60 * 1000));
			reasons.push(`Ootan odavamat hinda ${hoursUntilCheapest}h pärast (${cheapestInWindow.price.toFixed(1)} s/kWh)`);

			if (tankTemp !== null) {
				reasons.push(`Boileri temp: ${tankTemp}°C (min: ${minTemp}°C)`);
			}
		}
	} else {
		// No price data for window - use threshold strategy
		if (currentPriceCentKwh < settings.low_price_threshold) {
			action = 'boost';
			targetTemp = boostTemp;
			reasons.push(`Hind ${currentPriceCentKwh.toFixed(1)} s/kWh alla piiri - boileri soojendamine`);
		} else {
			action = 'reduce';
			targetTemp = minTemp;
			reasons.push(`Hinnaandmed puuduvad, hind ${currentPriceCentKwh.toFixed(1)} s/kWh`);
		}
	}

	return {
		action,
		reason: reasons.join('; '),
		targetTemperature: targetTemp,
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
}> {
	try {
		// Get settings
		const settings = await getSettings(db);

		// Get current price
		const currentPriceEurMwh = await getCurrentHourPrice(db);
		if (currentPriceEurMwh === null) {
			return {
				success: false,
				message: 'Could not get current electricity price'
			};
		}

		const currentPriceCentKwh = eurMwhToCentKwh(currentPriceEurMwh);

		// Get prices for analysis
		const todayPrices = await getTodayPrices(db);
		const tomorrowPrices = await getTomorrowPrices(db);
		const allPrices = [...todayPrices, ...tomorrowPrices];

		// Get current hour timestamp
		const now = new Date();
		const currentTimestamp = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
			now.getHours()
		).toISOString();

		// Get access token
		const accessToken = await getValidAccessToken(db, clientId, clientSecret);
		if (!accessToken) {
			return {
				success: false,
				message: 'Not connected to Daikin (no valid access token)'
			};
		}

		// Get devices
		const devices = await getDevices(accessToken);
		if (devices.length === 0) {
			return {
				success: false,
				message: 'No Daikin devices found'
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
				message: 'This smart heating strategy only supports water-based systems (Altherma)'
			};
		}

		// Calculate control decision using smart strategy
		const decision = calculateSmartHeatingAction(
			currentPriceCentKwh,
			currentTimestamp,
			allPrices,
			settings,
			deviceState.water_temp
		);

		// Calculate DHW decision if enabled
		let dhwDecision: DHWControlDecision | null = null;
		if (settings.dhw_enabled && dhwControlId) {
			dhwDecision = calculateDHWAction(
				currentPriceCentKwh,
				currentTimestamp,
				allPrices,
				settings,
				dhwState
			);
		}

		// Save current state with price, action, DHW data, and consumption
		const stateToSave: DeviceState = {
			...deviceState,
			timestamp: new Date().toISOString(),
			price_cent_kwh: currentPriceCentKwh,
			action_taken: decision.action,
			dhw_tank_temp: dhwState?.tank_temp ?? null,
			dhw_target_temp: dhwState?.target_temp ?? null,
			dhw_action: dhwDecision?.action ?? null,
			heating_kwh: consumptionData.heating_today_kwh,
			cooling_kwh: consumptionData.cooling_today_kwh,
			dhw_kwh: consumptionData.dhw_today_kwh
		};
		await saveDeviceState(db, stateToSave);

		// Save hourly consumption data
		const todayDateStr = new Date().toISOString().split('T')[0];
		await saveHourlyConsumption(db, todayDateStr, consumptionData);

		const messages: string[] = [];

		// Apply heating temperature change
		if (climateControlId && deviceState.target_offset !== decision.targetTemperature) {
			await setHeatingTemperature(
				accessToken,
				device.id,
				climateControlId,
				decision.targetTemperature,
				true // isWaterOffset
			);

			// Log the control action
			await logControlAction(db, {
				timestamp: new Date().toISOString(),
				action: decision.action,
				reason: decision.reason,
				price_eur_mwh: currentPriceEurMwh,
				old_target_temp: deviceState.target_offset,
				new_target_temp: decision.targetTemperature
			});

			messages.push(`Küte: nihe ${deviceState.target_offset} → ${decision.targetTemperature} (${decision.action})`);
		} else {
			messages.push(`Küte: muutust pole (nihe ${decision.targetTemperature})`);
		}

		// Apply DHW temperature change if enabled
		if (dhwDecision && dhwControlId) {
			const currentDhwTarget = dhwState?.target_temp ?? 0;
			if (currentDhwTarget !== dhwDecision.targetTemperature) {
				await setDHWTemperature(
					accessToken,
					device.id,
					dhwControlId,
					dhwDecision.targetTemperature
				);

				// Log DHW control action
				await logControlAction(db, {
					timestamp: new Date().toISOString(),
					action: `dhw_${dhwDecision.action}`,
					reason: dhwDecision.reason,
					price_eur_mwh: currentPriceEurMwh,
					old_target_temp: currentDhwTarget,
					new_target_temp: dhwDecision.targetTemperature
				});

				messages.push(`Boiler: siht ${currentDhwTarget}°C → ${dhwDecision.targetTemperature}°C (${dhwDecision.action})`);
			} else {
				messages.push(`Boiler: muutust pole (siht ${dhwDecision.targetTemperature}°C)`);
			}
		}

		return {
			success: true,
			message: messages.join('; '),
			decision,
			deviceState: stateToSave
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

		const currentPriceEurMwh = await getCurrentHourPrice(db);
		if (currentPriceEurMwh === null) {
			return null;
		}

		const currentPriceCentKwh = eurMwhToCentKwh(currentPriceEurMwh);

		const todayPrices = await getTodayPrices(db);
		const tomorrowPrices = await getTomorrowPrices(db);
		const allPrices = [...todayPrices, ...tomorrowPrices];

		const now = new Date();
		const currentTimestamp = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
			now.getHours()
		).toISOString();

		// For preview, we don't have water temp, so pass null
		return calculateSmartHeatingAction(
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
