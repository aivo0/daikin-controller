// Electricity price data
export interface PriceData {
	timestamp: string; // ISO 8601
	price_eur_mwh: number;
}

export interface HourlyPrice {
	hour: number;
	price: number; // c/kWh
	timestamp: string;
	isExpensive: boolean;
	isCheap: boolean;
	isCurrent: boolean;
}

// Device state
export interface DeviceState {
	device_id: string;
	water_temp: number | null;
	outdoor_temp: number | null;
	target_offset: number | null;
	mode: string | null;
	power_on: boolean;
	timestamp?: string;
	price_cent_kwh?: number;
	action_taken?: string;
}

// Settings
export interface Settings {
	min_temperature: number;
	base_temperature: number;
	boost_delta: number;
	reduce_delta: number;
	low_price_threshold: number;
	high_price_threshold: number;
	cheapest_hours: number;
	peak_hours_to_avoid: number;
	strategies_enabled: {
		threshold: boolean;
		cheapest: boolean;
		peaks: boolean;
	};
	// New smart heating settings
	min_water_temp: number;        // Don't let water drop below this (20°C)
	target_water_temp: number;     // Heat up to this when boosting (32°C)
	best_price_window_hours: number; // Look for best price in this window (6h)
}

// Control action types
export type ControlAction = 'boost' | 'normal' | 'reduce' | 'none';

export interface ControlDecision {
	action: ControlAction;
	reason: string;
	targetTemperature: number;
	currentPrice: number;
}

// Control log entry
export interface ControlLogEntry {
	id: number;
	timestamp: string;
	action: string;
	reason: string | null;
	price_eur_mwh: number | null;
	old_target_temp: number | null;
	new_target_temp: number | null;
}

// Daikin API types
export interface DaikinTokens {
	access_token: string;
	refresh_token: string;
	expires_at: string;
}

export interface DaikinDevice {
	id: string;
	name: string;
	managementPoints: DaikinManagementPoint[];
}

export interface DaikinManagementPoint {
	managementPointType: string;
	embeddedId: string;
	temperatureControl?: {
		value: {
			operationModes: {
				heating?: {
					setpoints: {
						roomTemperature: { value: number };
					};
				};
			};
		};
	};
	sensoryData?: {
		value: {
			roomTemperature?: { value: number };
			outdoorTemperature?: { value: number };
		};
	};
	onOffMode?: {
		value: 'on' | 'off';
	};
	operationMode?: {
		value: string;
	};
}

// Elering API response
export interface EleringPriceResponse {
	success: boolean;
	data: {
		ee: Array<{
			timestamp: number;
			price: number;
		}>;
	};
}
