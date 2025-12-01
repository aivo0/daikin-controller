import type { Database } from './db';
import { getTokens, saveTokens } from './db';
import type { DaikinTokens, DaikinDevice, DaikinManagementPoint, DeviceState, DHWState } from '$lib/types';

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
 */
export async function getValidAccessToken(
	db: Database,
	clientId: string,
	clientSecret: string
): Promise<string | null> {
	const tokens = await getTokens(db);

	if (!tokens) {
		return null;
	}

	const expiresAt = new Date(tokens.expires_at);
	const now = new Date();

	// Refresh if token expires in less than 5 minutes
	if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
		try {
			const newTokens = await refreshAccessToken(tokens.refresh_token, clientId, clientSecret);
			await saveTokens(db, newTokens);
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
 */
export async function isConnected(db: Database): Promise<boolean> {
	const tokens = await getTokens(db);
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
