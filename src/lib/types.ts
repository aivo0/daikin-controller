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
	// DHW state
	dhw_tank_temp?: number | null;
	dhw_target_temp?: number | null;
	dhw_action?: string;
	// Energy consumption (kWh)
	heating_kwh?: number | null;
	cooling_kwh?: number | null;
	dhw_kwh?: number | null;
}

// DHW (Domestic Hot Water) state
export interface DHWState {
	tank_temp: number | null;      // Current tank temperature
	target_temp: number | null;    // Target temperature setting
}

// Single consumption block (2-hour period)
export interface ConsumptionBlock {
	date: string;        // Date string (YYYY-MM-DD)
	startHour: number;   // Start hour of 2-hour block (0, 2, 4, ..., 22)
	heating_kwh: number | null;
	cooling_kwh: number | null;
	dhw_kwh: number | null;
}

// Energy consumption data (kWh)
// Daikin d[] array has 24 slots: d[0-11]=yesterday, d[12-23]=today
// Each slot is a 2-hour block
export interface ConsumptionData {
	heating_today_kwh: number | null;    // Today's heating consumption (sum)
	cooling_today_kwh: number | null;    // Today's cooling consumption (sum)
	dhw_today_kwh: number | null;        // Today's DHW consumption (sum)
	// All consumption blocks (both yesterday and today)
	blocks: ConsumptionBlock[];
	// Weekly consumption (w[] array - last 14 weeks, index 0 = oldest)
	weekly: WeeklyConsumption[];
	// Monthly consumption (m[] array - last 24 months, index 0 = oldest)
	monthly: MonthlyConsumption[];
}

// Weekly consumption record
// Daikin w[] array has 14 slots for last 14 weeks
export interface WeeklyConsumption {
	week_start: string;  // ISO date of week start (Monday)
	heating_kwh: number | null;
	cooling_kwh: number | null;
	dhw_kwh: number | null;
}

// Monthly consumption record
// Daikin m[] array has 24 slots for last 24 months
export interface MonthlyConsumption {
	month: string;  // YYYY-MM format
	heating_kwh: number | null;
	cooling_kwh: number | null;
	dhw_kwh: number | null;
}

// Hourly consumption record for database
// Note: hour represents start of 2-hour block (0, 2, 4, ..., 22)
export interface HourlyConsumption {
	timestamp: string;  // Date in ISO format (date only, no time)
	hour: number;       // Start hour of 2-hour block (0, 2, 4, ..., 22)
	heating_kwh: number | null;
	cooling_kwh: number | null;
	dhw_kwh: number | null;
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
	// DHW (sooja vee boileri) settings
	dhw_enabled: boolean;          // Enable DHW control
	dhw_min_temp: number;          // Minimum DHW temp (default: 30°C)
	dhw_target_temp: number;       // Target when boosting (default: 60°C)
	// New algorithm settings (daily planning)
	price_sensitivity: number;         // K constant for offset calculation (1-10, default 7)
	planning_hour: number;             // Hour to run daily planning (default 15)
	weather_location_lat: number;      // Latitude for weather forecast
	weather_location_lon: number;      // Longitude for weather forecast
	planning_needs_retry: boolean;     // Set to true if planning fails, retry on next cron
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
	consumptionData?: {
		value?: {
			electrical?: {
				heating?: { d?: (number | null)[]; w?: (number | null)[]; m?: (number | null)[] };
				cooling?: { d?: (number | null)[]; w?: (number | null)[]; m?: (number | null)[] };
			};
		};
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

// Weather forecast data
export interface WeatherForecast {
	timestamp: string;      // ISO 8601 timestamp
	temperature_2m: number; // Temperature in Celsius
}

// Planned heating hour (for daily schedule)
export interface PlannedHeatingHour {
	hour: number;                         // 0-23
	planned_offset: number;               // -10 to +10
	outdoor_temp_forecast: number | null; // Forecasted outdoor temp
	price_cent_kwh: number;               // Price for this hour
	reason: string;                       // Human-readable explanation
	date?: string;                        // YYYY-MM-DD (for multi-day planning)
}

// Planned DHW hour (for daily schedule)
export interface PlannedDHWHour {
	hour: number;              // 0-23
	planned_temp: number;      // 30-55
	price_cent_kwh: number;    // Price for this hour
	reason: string;            // Human-readable explanation
	date?: string;             // YYYY-MM-DD (for multi-day planning)
}

// Daily heating schedule
export interface DailyHeatingSchedule {
	date: string;                   // YYYY-MM-DD
	hours: PlannedHeatingHour[];    // 24 hours
	created_at?: string;
}

// Daily DHW schedule
export interface DailyDHWSchedule {
	date: string;                   // YYYY-MM-DD
	hours: PlannedDHWHour[];        // 24 hours
	created_at?: string;
}

// Combined daily schedule
export interface DailySchedule {
	date: string;
	heating: PlannedHeatingHour[];
	dhw: PlannedDHWHour[];
	created_at?: string;
}
