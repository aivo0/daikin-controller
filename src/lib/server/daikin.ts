import type { Database } from './db';
import { getTokens, saveTokens, getUserTokens, saveUserTokens } from './db';
import type { DaikinTokens, DaikinDevice, DaikinManagementPoint, DeviceState, DHWState, ConsumptionData, ConsumptionBlock, WeeklyConsumption, MonthlyConsumption } from '$lib/types';

const DAIKIN_AUTH_URL = 'https://idp.onecta.daikineurope.com/v1/oidc/authorize';
const DAIKIN_TOKEN_URL = 'https://idp.onecta.daikineurope.com/v1/oidc/token';
const DAIKIN_API_URL = 'https://api.onecta.daikineurope.com/v1';

/**
 * Generate OAuth authorization URL
 */
export function getAuthorizationUrl(
	clientId: string,
	redirectUri: string,
	state: string
): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: 'openid onecta:basic.integration',
		state: state
	});

	return `${DAIKIN_AUTH_URL}?${params}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
	code: string,
	clientId: string,
	clientSecret: string,
	redirectUri: string
): Promise<DaikinTokens> {
	console.log('Token exchange request:', {
		url: DAIKIN_TOKEN_URL,
		redirectUri,
		codeLength: code.length
	});

	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code: code,
		redirect_uri: redirectUri,
		client_id: clientId,
		client_secret: clientSecret
	});

	const response = await fetch(DAIKIN_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: body
	});

	const responseText = await response.text();
	console.log('Token exchange response:', response.status, responseText);

	if (!response.ok) {
		throw new Error(`Token exchange failed: ${response.status} - ${responseText}`);
	}

	const data = JSON.parse(responseText);

	const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

	return {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: expiresAt
	};
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
	refreshToken: string,
	clientId: string,
	clientSecret: string
): Promise<DaikinTokens> {
	const response = await fetch(DAIKIN_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken
		})
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Token refresh failed: ${response.status} - ${error}`);
	}

	const data = await response.json();

	const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

	return {
		access_token: data.access_token,
		refresh_token: data.refresh_token || refreshToken,
		expires_at: expiresAt
	};
}

/**
 * Get valid access token, refreshing if necessary
 * If userId is provided, uses user-scoped tokens; otherwise falls back to legacy single-user tokens
 */
export async function getValidAccessToken(
	db: Database,
	clientId: string,
	clientSecret: string,
	userId?: string
): Promise<string | null> {
	// Get tokens - user-scoped if userId provided, otherwise legacy
	const tokens = userId
		? await getUserTokens(db, userId)
		: await getTokens(db);

	if (!tokens) {
		return null;
	}

	const expiresAt = new Date(tokens.expires_at);
	const now = new Date();

	// Refresh if token expires in less than 5 minutes
	if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
		try {
			const newTokens = await refreshAccessToken(tokens.refresh_token, clientId, clientSecret);
			// Save tokens - user-scoped if userId provided, otherwise legacy
			if (userId) {
				await saveUserTokens(db, userId, newTokens);
			} else {
				await saveTokens(db, newTokens);
			}
			return newTokens.access_token;
		} catch (error) {
			console.error('Failed to refresh token:', error);
			return null;
		}
	}

	return tokens.access_token;
}

/**
 * Make authenticated API request to Daikin
 */
async function apiRequest<T>(
	accessToken: string,
	endpoint: string,
	method: 'GET' | 'PATCH' = 'GET',
	body?: unknown
): Promise<T> {
	const response = await fetch(`${DAIKIN_API_URL}${endpoint}`, {
		method,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: body ? JSON.stringify(body) : undefined
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Daikin API error: ${response.status} - ${error}`);
	}

	// Handle empty responses (common for PATCH requests)
	const text = await response.text();
	if (!text) {
		return {} as T;
	}

	return JSON.parse(text);
}

/**
 * Get list of connected devices
 */
export async function getDevices(accessToken: string): Promise<DaikinDevice[]> {
	return apiRequest<DaikinDevice[]>(accessToken, '/gateway-devices');
}

/**
 * Get device details
 */
export async function getDeviceDetails(
	accessToken: string,
	deviceId: string
): Promise<DaikinDevice> {
	return apiRequest<DaikinDevice>(accessToken, `/gateway-devices/${deviceId}`);
}

/**
 * Parse device state from management points
 * Supports both air-based (room temp) and water-based (leaving water temp) systems
 */
export function parseDeviceState(device: DaikinDevice): DeviceState {
	const climateControl = device.managementPoints.find(
		(mp) => mp.managementPointType === 'climateControl'
	);

	let waterTemp: number | null = null;
	let outdoorTemp: number | null = null;
	let targetOffset: number | null = null;
	let mode: string | null = null;
	let powerOn = false;

	if (climateControl) {
		// Get power state
		const onOff = climateControl.onOffMode as { value?: string } | undefined;
		if (onOff?.value) {
			powerOn = onOff.value === 'on';
		}

		// Get operation mode
		const opMode = climateControl.operationMode as { value?: string } | undefined;
		if (opMode?.value) {
			mode = opMode.value;
		}

		// Get sensory data
		const sensory = climateControl.sensoryData as { value?: Record<string, { value?: number }> } | undefined;
		if (sensory?.value) {
			// Get leaving water temperature (Altherma)
			if (sensory.value.leavingWaterTemperature?.value !== undefined) {
				waterTemp = sensory.value.leavingWaterTemperature.value;
			}
			// Get outdoor temperature
			if (sensory.value.outdoorTemperature?.value !== undefined) {
				outdoorTemp = sensory.value.outdoorTemperature.value;
			}
		}

		// Get temperature control setpoint (offset for water-based)
		const tempControl = climateControl.temperatureControl as {
			value?: {
				operationModes?: {
					heating?: { setpoints?: Record<string, { value?: number }> };
				};
			};
		} | undefined;

		if (tempControl?.value?.operationModes?.heating?.setpoints) {
			const setpoints = tempControl.value.operationModes.heating.setpoints;
			if (setpoints.leavingWaterOffset?.value !== undefined) {
				targetOffset = setpoints.leavingWaterOffset.value;
			}
		}
	}

	return {
		device_id: device.id,
		water_temp: waterTemp,
		outdoor_temp: outdoorTemp,
		target_offset: targetOffset,
		mode: mode,
		power_on: powerOn
	};
}

/**
 * Set heating target temperature or offset
 * For water-based systems (Altherma): sets leavingWaterOffset (-10 to +10)
 * For air-based systems: sets roomTemperature
 */
export async function setHeatingTemperature(
	accessToken: string,
	deviceId: string,
	managementPointId: string,
	value: number,
	isWaterOffset: boolean = true
): Promise<void> {
	const setpointKey = isWaterOffset ? 'leavingWaterOffset' : 'roomTemperature';

	await apiRequest(
		accessToken,
		`/gateway-devices/${deviceId}/management-points/${managementPointId}/characteristics/temperatureControl`,
		'PATCH',
		{
			value: {
				operationModes: {
					heating: {
						setpoints: {
							[setpointKey]: {
								value: value
							}
						}
					}
				}
			}
		}
	);
}

/**
 * Detect if device uses water-based control (Altherma) or room temperature
 */
export function isWaterBasedSystem(device: DaikinDevice): boolean {
	const climateControl = device.managementPoints.find(
		(mp) => mp.managementPointType === 'climateControl'
	);

	if (!climateControl) return false;

	const tempControl = climateControl.temperatureControl as {
		value?: {
			operationModes?: {
				heating?: { setpoints?: Record<string, unknown> };
			};
		};
	} | undefined;

	const setpoints = tempControl?.value?.operationModes?.heating?.setpoints;
	return setpoints ? 'leavingWaterOffset' in setpoints : false;
}

/**
 * Find the climate control management point ID
 */
export function findClimateControlId(device: DaikinDevice): string | null {
	const climateControl = device.managementPoints.find(
		(mp) => mp.managementPointType === 'climateControl'
	);
	return climateControl?.embeddedId ?? null;
}

/**
 * Check if we're connected to Daikin (have valid tokens)
 * If userId is provided, checks user-scoped tokens; otherwise falls back to legacy
 */
export async function isConnected(db: Database, userId?: string): Promise<boolean> {
	const tokens = userId
		? await getUserTokens(db, userId)
		: await getTokens(db);
	return tokens !== null;
}

/**
 * Find the DHW (domestic hot water tank) management point ID
 */
export function findDHWControlId(device: DaikinDevice): string | null {
	const dhw = device.managementPoints.find(
		(mp) => mp.managementPointType === 'domesticHotWaterTank'
	);
	return dhw?.embeddedId ?? null;
}

/**
 * Parse DHW state from device management points
 */
export function parseDHWState(device: DaikinDevice): DHWState | null {
	const dhw = device.managementPoints.find(
		(mp) => mp.managementPointType === 'domesticHotWaterTank'
	);

	if (!dhw) return null;

	let tankTemp: number | null = null;
	let targetTemp: number | null = null;

	// Get tank temperature from sensoryData
	const sensory = dhw.sensoryData as { value?: { tankTemperature?: { value?: number } } } | undefined;
	if (sensory?.value?.tankTemperature?.value !== undefined) {
		tankTemp = sensory.value.tankTemperature.value;
	}

	// Get target temperature from temperatureControl
	const tempControl = dhw.temperatureControl as {
		value?: {
			operationModes?: {
				heating?: {
					setpoints?: {
						domesticHotWaterTemperature?: { value?: number };
					};
				};
			};
		};
	} | undefined;

	if (tempControl?.value?.operationModes?.heating?.setpoints?.domesticHotWaterTemperature?.value !== undefined) {
		targetTemp = tempControl.value.operationModes.heating.setpoints.domesticHotWaterTemperature.value;
	}

	return {
		tank_temp: tankTemp,
		target_temp: targetTemp
	};
}

/**
 * Set DHW target temperature (30-60°C)
 */
export async function setDHWTemperature(
	accessToken: string,
	deviceId: string,
	dhwPointId: string,
	temperature: number
): Promise<void> {
	// Clamp temperature to valid range
	const clampedTemp = Math.max(30, Math.min(60, temperature));

	await apiRequest(
		accessToken,
		`/gateway-devices/${deviceId}/management-points/${dhwPointId}/characteristics/temperatureControl`,
		'PATCH',
		{
			value: {
				operationModes: {
					heating: {
						setpoints: {
							domesticHotWaterTemperature: {
								value: clampedTemp
							}
						}
					}
				}
			}
		}
	);
}

/**
 * Sum consumption values from an array
 */
function sumConsumption(values: (number | null)[]): number | null {
	const nums = values.filter((v): v is number => v !== null && typeof v === 'number');
	if (nums.length === 0) return null;
	return nums.reduce((sum, v) => sum + v, 0);
}

/**
 * Parse energy consumption data from device
 *
 * Daikin arrays:
 * - d[] (24 slots): daily 2-hour blocks, d[0-11]=yesterday, d[12-23]=today
 * - w[] (14 slots): weekly data, index 0 = oldest week (13 weeks ago)
 * - m[] (24 slots): monthly data, index 0 = oldest month (23 months ago)
 */
export function parseConsumptionData(device: DaikinDevice): ConsumptionData {
	const heatingRaw: (number | null)[] = new Array(24).fill(null);
	const coolingRaw: (number | null)[] = new Array(24).fill(null);
	const dhwRaw: (number | null)[] = new Array(24).fill(null);

	// Weekly and monthly raw data
	const heatingWeekly: (number | null)[] = new Array(14).fill(null);
	const coolingWeekly: (number | null)[] = new Array(14).fill(null);
	const dhwWeekly: (number | null)[] = new Array(14).fill(null);

	const heatingMonthly: (number | null)[] = new Array(24).fill(null);
	const coolingMonthly: (number | null)[] = new Array(24).fill(null);
	const dhwMonthly: (number | null)[] = new Array(24).fill(null);

	// Helper to extract all consumption data from a management point
	const extractConsumption = (mp: DaikinManagementPoint): {
		heating_d?: (number | null)[];
		cooling_d?: (number | null)[];
		heating_w?: (number | null)[];
		cooling_w?: (number | null)[];
		heating_m?: (number | null)[];
		cooling_m?: (number | null)[];
	} => {
		const consumption = mp.consumptionData as {
			value?: {
				electrical?: {
					heating?: { d?: (number | null)[]; w?: (number | null)[]; m?: (number | null)[] };
					cooling?: { d?: (number | null)[]; w?: (number | null)[]; m?: (number | null)[] };
				};
			};
		} | undefined;

		return {
			heating_d: consumption?.value?.electrical?.heating?.d,
			cooling_d: consumption?.value?.electrical?.cooling?.d,
			heating_w: consumption?.value?.electrical?.heating?.w,
			cooling_w: consumption?.value?.electrical?.cooling?.w,
			heating_m: consumption?.value?.electrical?.heating?.m,
			cooling_m: consumption?.value?.electrical?.cooling?.m
		};
	};

	// Get climateControl consumption (heating/cooling)
	const climateControl = device.managementPoints.find(
		(mp) => mp.managementPointType === 'climateControl'
	);

	if (climateControl) {
		const data = extractConsumption(climateControl);

		// Daily data
		if (data.heating_d) {
			data.heating_d.slice(0, 24).forEach((v, i) => { heatingRaw[i] = v; });
		}
		if (data.cooling_d) {
			data.cooling_d.slice(0, 24).forEach((v, i) => { coolingRaw[i] = v; });
		}

		// Weekly data
		if (data.heating_w) {
			data.heating_w.slice(0, 14).forEach((v, i) => { heatingWeekly[i] = v; });
		}
		if (data.cooling_w) {
			data.cooling_w.slice(0, 14).forEach((v, i) => { coolingWeekly[i] = v; });
		}

		// Monthly data
		if (data.heating_m) {
			data.heating_m.slice(0, 24).forEach((v, i) => { heatingMonthly[i] = v; });
		}
		if (data.cooling_m) {
			data.cooling_m.slice(0, 24).forEach((v, i) => { coolingMonthly[i] = v; });
		}
	}

	// Get DHW consumption
	const dhw = device.managementPoints.find(
		(mp) => mp.managementPointType === 'domesticHotWaterTank'
	);

	if (dhw) {
		const data = extractConsumption(dhw);

		// Daily data
		if (data.heating_d) {
			data.heating_d.slice(0, 24).forEach((v, i) => { dhwRaw[i] = v; });
		}

		// Weekly data
		if (data.heating_w) {
			data.heating_w.slice(0, 14).forEach((v, i) => { dhwWeekly[i] = v; });
		}

		// Monthly data
		if (data.heating_m) {
			data.heating_m.slice(0, 24).forEach((v, i) => { dhwMonthly[i] = v; });
		}
	}

	// Calculate dates
	const now = new Date();
	const today = now.toISOString().split('T')[0];
	const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

	// Build daily consumption blocks
	// d[0-11] = yesterday, d[12-23] = today
	// Each index maps to a 2-hour block: index % 12 * 2 = start hour
	const blocks: ConsumptionBlock[] = [];

	for (let i = 0; i < 24; i++) {
		const isToday = i >= 12;
		const date = isToday ? today : yesterday;
		const startHour = (i % 12) * 2;

		const heating = heatingRaw[i];
		const cooling = coolingRaw[i];
		const dhwVal = dhwRaw[i];

		if (heating !== null || cooling !== null || dhwVal !== null) {
			blocks.push({
				date,
				startHour,
				heating_kwh: heating,
				cooling_kwh: cooling,
				dhw_kwh: dhwVal
			});
		}
	}

	// Build weekly consumption array
	// w[0] = oldest week (13 weeks ago), w[13] = current week
	const weekly: WeeklyConsumption[] = [];
	for (let i = 0; i < 14; i++) {
		const weeksAgo = 13 - i;
		const weekStart = getWeekStart(new Date(now.getTime() - weeksAgo * 7 * 24 * 60 * 60 * 1000));

		const heating = heatingWeekly[i];
		const cooling = coolingWeekly[i];
		const dhwVal = dhwWeekly[i];

		if (heating !== null || cooling !== null || dhwVal !== null) {
			weekly.push({
				week_start: weekStart,
				heating_kwh: heating,
				cooling_kwh: cooling,
				dhw_kwh: dhwVal
			});
		}
	}

	// Build monthly consumption array
	// m[0] = oldest month (23 months ago), m[23] = current month
	const monthly: MonthlyConsumption[] = [];
	for (let i = 0; i < 24; i++) {
		const monthsAgo = 23 - i;
		const monthDate = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
		const month = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;

		const heating = heatingMonthly[i];
		const cooling = coolingMonthly[i];
		const dhwVal = dhwMonthly[i];

		if (heating !== null || cooling !== null || dhwVal !== null) {
			monthly.push({
				month,
				heating_kwh: heating,
				cooling_kwh: cooling,
				dhw_kwh: dhwVal
			});
		}
	}

	// Sum only today's values (d[12-23])
	const todayHeating = sumConsumption(heatingRaw.slice(12, 24));
	const todayCooling = sumConsumption(coolingRaw.slice(12, 24));
	const todayDhw = sumConsumption(dhwRaw.slice(12, 24));

	return {
		heating_today_kwh: todayHeating,
		cooling_today_kwh: todayCooling,
		dhw_today_kwh: todayDhw,
		blocks,
		weekly,
		monthly
	};
}

/**
 * Get the Monday of the week for a given date (ISO week start)
 */
function getWeekStart(date: Date): string {
	const d = new Date(date);
	const day = d.getDay();
	const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
	d.setDate(diff);
	return d.toISOString().split('T')[0];
}
