import type { Settings, PriceData, DeviceState, ControlLogEntry, DaikinTokens, ConsumptionData, HourlyConsumption, WeeklyConsumption, MonthlyConsumption, PlannedHeatingHour, PlannedDHWHour, DailySchedule } from '$lib/types';

// Database interface that works with both D1 and better-sqlite3
export interface Database {
	exec(sql: string): Promise<void>;
	run(sql: string, ...params: unknown[]): Promise<void>;
	get<T>(sql: string, ...params: unknown[]): Promise<T | null>;
	all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

// Wrapper for Cloudflare D1
export function createD1Wrapper(d1: D1Database): Database {
	return {
		async exec(sql: string) {
			await d1.exec(sql);
		},
		async run(sql: string, ...params: unknown[]) {
			await d1.prepare(sql).bind(...params).run();
		},
		async get<T>(sql: string, ...params: unknown[]): Promise<T | null> {
			const result = await d1.prepare(sql).bind(...params).first<T>();
			return result ?? null;
		},
		async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
			const result = await d1.prepare(sql).bind(...params).all<T>();
			return result.results;
		}
	};
}

// Settings helpers
export async function getSettings(db: Database): Promise<Settings> {
	const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings');

	const settingsMap = new Map(rows.map((r) => [r.key, r.value]));

	return {
		min_temperature: parseFloat(settingsMap.get('min_temperature') || '20'),
		base_temperature: parseFloat(settingsMap.get('base_temperature') || '22'),
		boost_delta: parseFloat(settingsMap.get('boost_delta') || '2'),
		reduce_delta: parseFloat(settingsMap.get('reduce_delta') || '2'),
		low_price_threshold: parseFloat(settingsMap.get('low_price_threshold') || '5'),
		high_price_threshold: parseFloat(settingsMap.get('high_price_threshold') || '15'),
		cheapest_hours: parseInt(settingsMap.get('cheapest_hours') || '4'),
		peak_hours_to_avoid: parseInt(settingsMap.get('peak_hours_to_avoid') || '3'),
		strategies_enabled: JSON.parse(
			settingsMap.get('strategies_enabled') ||
				'{"threshold":true,"cheapest":true,"peaks":true}'
		),
		// New smart heating settings
		min_water_temp: parseFloat(settingsMap.get('min_water_temp') || '20'),
		target_water_temp: parseFloat(settingsMap.get('target_water_temp') || '32'),
		best_price_window_hours: parseInt(settingsMap.get('best_price_window_hours') || '6'),
		// DHW (sooja vee boiler) settings - range 30-60°C
		dhw_enabled: settingsMap.get('dhw_enabled') === 'true',
		dhw_min_temp: parseFloat(settingsMap.get('dhw_min_temp') || '30'),
		dhw_target_temp: parseFloat(settingsMap.get('dhw_target_temp') || '60'),
		// New algorithm settings (daily planning)
		price_sensitivity: parseFloat(settingsMap.get('price_sensitivity') || '7'),
		cold_weather_threshold: parseFloat(settingsMap.get('cold_weather_threshold') || '-5'),
		planning_hour: parseInt(settingsMap.get('planning_hour') || '15'),
		weather_location_lat: parseFloat(settingsMap.get('weather_location_lat') || '59.3'),
		weather_location_lon: parseFloat(settingsMap.get('weather_location_lon') || '24.7')
	};
}

export async function updateSetting(db: Database, key: string, value: string): Promise<void> {
	await db.run(
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key,
		value
	);
}

// Price helpers
export async function savePrices(db: Database, prices: PriceData[]): Promise<void> {
	for (const price of prices) {
		await db.run(
			`INSERT INTO prices (timestamp, price_eur_mwh) VALUES (?, ?)
       ON CONFLICT(timestamp) DO UPDATE SET price_eur_mwh = excluded.price_eur_mwh`,
			price.timestamp,
			price.price_eur_mwh
		);
	}
}

export async function getPricesForRange(
	db: Database,
	start: string,
	end: string
): Promise<PriceData[]> {
	return db.all<PriceData>(
		'SELECT timestamp, price_eur_mwh FROM prices WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp',
		start,
		end
	);
}

export async function getCurrentPrice(db: Database): Promise<PriceData | null> {
	const now = new Date();
	const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
	return db.get<PriceData>(
		'SELECT timestamp, price_eur_mwh FROM prices WHERE timestamp = ?',
		hourStart.toISOString()
	);
}

// Device state helpers
export async function saveDeviceState(
	db: Database,
	state: DeviceState
): Promise<void> {
	// Use both old and new column names for compatibility
	await db.run(
		`INSERT INTO device_state (timestamp, device_id, room_temp, target_temp, water_temp, outdoor_temp, target_offset, mode, power_on, price_cent_kwh, action_taken, dhw_tank_temp, dhw_target_temp, dhw_action, heating_kwh, cooling_kwh, dhw_kwh)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		state.timestamp || new Date().toISOString(),
		state.device_id,
		state.water_temp, // old column
		state.target_offset, // old column
		state.water_temp, // new column
		state.outdoor_temp,
		state.target_offset,
		state.mode,
		state.power_on ? 1 : 0,
		state.price_cent_kwh || null,
		state.action_taken || null,
		state.dhw_tank_temp ?? null,
		state.dhw_target_temp ?? null,
		state.dhw_action ?? null,
		state.heating_kwh ?? null,
		state.cooling_kwh ?? null,
		state.dhw_kwh ?? null
	);
}

export async function getLatestDeviceState(db: Database): Promise<DeviceState | null> {
	// Support both old and new column names
	const row = await db.get<{
		device_id: string;
		room_temp: number | null;
		target_temp: number | null;
		water_temp: number | null;
		outdoor_temp: number | null;
		target_offset: number | null;
		mode: string | null;
		power_on: number;
		timestamp: string;
		dhw_tank_temp: number | null;
		dhw_target_temp: number | null;
		dhw_action: string | null;
		heating_kwh: number | null;
		cooling_kwh: number | null;
		dhw_kwh: number | null;
	}>('SELECT device_id, room_temp, target_temp, water_temp, outdoor_temp, target_offset, mode, power_on, timestamp, dhw_tank_temp, dhw_target_temp, dhw_action, heating_kwh, cooling_kwh, dhw_kwh FROM device_state ORDER BY timestamp DESC LIMIT 1');

	if (!row) return null;

	return {
		device_id: row.device_id,
		water_temp: row.water_temp ?? row.room_temp,
		outdoor_temp: row.outdoor_temp,
		target_offset: row.target_offset ?? row.target_temp,
		mode: row.mode,
		power_on: row.power_on === 1,
		timestamp: row.timestamp,
		dhw_tank_temp: row.dhw_tank_temp,
		dhw_target_temp: row.dhw_target_temp,
		dhw_action: row.dhw_action ?? undefined,
		heating_kwh: row.heating_kwh,
		cooling_kwh: row.cooling_kwh,
		dhw_kwh: row.dhw_kwh
	};
}

export async function getDeviceStateHistory(db: Database, hours: number = 24): Promise<DeviceState[]> {
	const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
	const rows = await db.all<{
		device_id: string;
		water_temp: number | null;
		outdoor_temp: number | null;
		target_offset: number | null;
		mode: string | null;
		power_on: number;
		timestamp: string;
		price_cent_kwh: number | null;
		action_taken: string | null;
		dhw_tank_temp: number | null;
		dhw_target_temp: number | null;
		dhw_action: string | null;
		heating_kwh: number | null;
		cooling_kwh: number | null;
		dhw_kwh: number | null;
	}>('SELECT * FROM device_state WHERE timestamp >= ? ORDER BY timestamp', since);

	return rows.map(row => ({
		device_id: row.device_id,
		water_temp: row.water_temp,
		outdoor_temp: row.outdoor_temp,
		target_offset: row.target_offset,
		mode: row.mode,
		power_on: row.power_on === 1,
		timestamp: row.timestamp,
		price_cent_kwh: row.price_cent_kwh ?? undefined,
		action_taken: row.action_taken ?? undefined,
		dhw_tank_temp: row.dhw_tank_temp,
		dhw_target_temp: row.dhw_target_temp,
		dhw_action: row.dhw_action ?? undefined,
		heating_kwh: row.heating_kwh,
		cooling_kwh: row.cooling_kwh,
		dhw_kwh: row.dhw_kwh
	}));
}

// Token helpers
export async function getTokens(db: Database): Promise<DaikinTokens | null> {
	return db.get<DaikinTokens>(
		'SELECT access_token, refresh_token, expires_at FROM tokens WHERE id = 1'
	);
}

export async function saveTokens(db: Database, tokens: DaikinTokens): Promise<void> {
	await db.run(
		`INSERT INTO tokens (id, access_token, refresh_token, expires_at, updated_at)
     VALUES (1, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
		tokens.access_token,
		tokens.refresh_token,
		tokens.expires_at
	);
}

// Control log helpers
export async function logControlAction(
	db: Database,
	entry: Omit<ControlLogEntry, 'id'>
): Promise<void> {
	await db.run(
		`INSERT INTO control_log (timestamp, action, reason, price_eur_mwh, old_target_temp, new_target_temp)
     VALUES (?, ?, ?, ?, ?, ?)`,
		entry.timestamp,
		entry.action,
		entry.reason,
		entry.price_eur_mwh,
		entry.old_target_temp,
		entry.new_target_temp
	);
}

export async function getRecentControlLogs(
	db: Database,
	limit: number = 50
): Promise<ControlLogEntry[]> {
	return db.all<ControlLogEntry>(
		'SELECT id, timestamp, action, reason, price_eur_mwh, old_target_temp, new_target_temp FROM control_log ORDER BY timestamp DESC LIMIT ?',
		limit
	);
}

// Energy consumption helpers
// Note: Daikin API returns null for timeslots where data is not yet available.
// We must NOT overwrite existing values with null - only update when we have actual data.
export async function saveHourlyConsumption(
	db: Database,
	consumption: ConsumptionData
): Promise<void> {
	// Save each 2-hour block from the consumption data
	for (const block of consumption.blocks) {
		await db.run(
			`INSERT INTO energy_consumption (timestamp, hour, heating_kwh, cooling_kwh, dhw_kwh)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(timestamp, hour) DO UPDATE SET
			   heating_kwh = COALESCE(excluded.heating_kwh, heating_kwh),
			   cooling_kwh = COALESCE(excluded.cooling_kwh, cooling_kwh),
			   dhw_kwh = COALESCE(excluded.dhw_kwh, dhw_kwh)`,
			block.date,
			block.startHour,
			block.heating_kwh,
			block.cooling_kwh,
			block.dhw_kwh
		);
	}

	// Save weekly consumption data
	for (const week of consumption.weekly) {
		await db.run(
			`INSERT INTO weekly_consumption (week_start, heating_kwh, cooling_kwh, dhw_kwh)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(week_start) DO UPDATE SET
			   heating_kwh = COALESCE(excluded.heating_kwh, heating_kwh),
			   cooling_kwh = COALESCE(excluded.cooling_kwh, cooling_kwh),
			   dhw_kwh = COALESCE(excluded.dhw_kwh, dhw_kwh)`,
			week.week_start,
			week.heating_kwh,
			week.cooling_kwh,
			week.dhw_kwh
		);
	}

	// Save monthly consumption data
	for (const month of consumption.monthly) {
		await db.run(
			`INSERT INTO monthly_consumption (month, heating_kwh, cooling_kwh, dhw_kwh)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(month) DO UPDATE SET
			   heating_kwh = COALESCE(excluded.heating_kwh, heating_kwh),
			   cooling_kwh = COALESCE(excluded.cooling_kwh, cooling_kwh),
			   dhw_kwh = COALESCE(excluded.dhw_kwh, dhw_kwh)`,
			month.month,
			month.heating_kwh,
			month.cooling_kwh,
			month.dhw_kwh
		);
	}
}

export async function getHourlyConsumption(
	db: Database,
	days: number = 7
): Promise<HourlyConsumption[]> {
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
	return db.all<HourlyConsumption>(
		`SELECT timestamp, hour, heating_kwh, cooling_kwh, dhw_kwh
		 FROM energy_consumption
		 WHERE timestamp >= ?
		 ORDER BY timestamp, hour`,
		since
	);
}

export async function getWeeklyConsumption(
	db: Database,
	weeks: number = 14
): Promise<WeeklyConsumption[]> {
	return db.all<WeeklyConsumption>(
		`SELECT week_start, heating_kwh, cooling_kwh, dhw_kwh
		 FROM weekly_consumption
		 ORDER BY week_start DESC
		 LIMIT ?`,
		weeks
	);
}

export async function getMonthlyConsumption(
	db: Database,
	months: number = 24
): Promise<MonthlyConsumption[]> {
	return db.all<MonthlyConsumption>(
		`SELECT month, heating_kwh, cooling_kwh, dhw_kwh
		 FROM monthly_consumption
		 ORDER BY month DESC
		 LIMIT ?`,
		months
	);
}

// ============================================
// Heating Schedule (Daily Planning) Helpers
// ============================================

/**
 * Save a daily heating schedule
 */
export async function saveHeatingSchedule(
	db: Database,
	date: string,
	hours: PlannedHeatingHour[]
): Promise<void> {
	for (const hour of hours) {
		await db.run(
			`INSERT INTO heating_schedule (date, hour, planned_offset, outdoor_temp_forecast, price_cent_kwh, reason)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, hour) DO UPDATE SET
         planned_offset = excluded.planned_offset,
         outdoor_temp_forecast = excluded.outdoor_temp_forecast,
         price_cent_kwh = excluded.price_cent_kwh,
         reason = excluded.reason,
         created_at = datetime('now'),
         applied_at = NULL`,
			date,
			hour.hour,
			hour.planned_offset,
			hour.outdoor_temp_forecast,
			hour.price_cent_kwh,
			hour.reason
		);
	}
}

/**
 * Get the heating schedule for a specific date
 */
export async function getHeatingScheduleForDate(
	db: Database,
	date: string
): Promise<PlannedHeatingHour[]> {
	const rows = await db.all<{
		hour: number;
		planned_offset: number;
		outdoor_temp_forecast: number | null;
		price_cent_kwh: number;
		reason: string;
	}>(
		'SELECT hour, planned_offset, outdoor_temp_forecast, price_cent_kwh, reason FROM heating_schedule WHERE date = ? ORDER BY hour',
		date
	);

	return rows.map(row => ({
		hour: row.hour,
		planned_offset: row.planned_offset,
		outdoor_temp_forecast: row.outdoor_temp_forecast,
		price_cent_kwh: row.price_cent_kwh,
		reason: row.reason
	}));
}

/**
 * Get the planned offset for a specific hour
 */
export async function getPlannedOffsetForHour(
	db: Database,
	date: string,
	hour: number
): Promise<number | null> {
	const row = await db.get<{ planned_offset: number }>(
		'SELECT planned_offset FROM heating_schedule WHERE date = ? AND hour = ?',
		date,
		hour
	);
	return row?.planned_offset ?? null;
}

/**
 * Mark a scheduled hour as applied
 */
export async function markHeatingScheduleApplied(
	db: Database,
	date: string,
	hour: number
): Promise<void> {
	await db.run(
		`UPDATE heating_schedule SET applied_at = datetime('now') WHERE date = ? AND hour = ?`,
		date,
		hour
	);
}

// ============================================
// DHW Schedule (Daily Planning) Helpers
// ============================================

/**
 * Save a daily DHW schedule
 */
export async function saveDHWSchedule(
	db: Database,
	date: string,
	hours: PlannedDHWHour[]
): Promise<void> {
	for (const hour of hours) {
		await db.run(
			`INSERT INTO dhw_schedule (date, hour, planned_temp, price_cent_kwh, reason)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date, hour) DO UPDATE SET
         planned_temp = excluded.planned_temp,
         price_cent_kwh = excluded.price_cent_kwh,
         reason = excluded.reason,
         created_at = datetime('now'),
         applied_at = NULL`,
			date,
			hour.hour,
			hour.planned_temp,
			hour.price_cent_kwh,
			hour.reason
		);
	}
}

/**
 * Get the DHW schedule for a specific date
 */
export async function getDHWScheduleForDate(
	db: Database,
	date: string
): Promise<PlannedDHWHour[]> {
	const rows = await db.all<{
		hour: number;
		planned_temp: number;
		price_cent_kwh: number;
		reason: string;
	}>(
		'SELECT hour, planned_temp, price_cent_kwh, reason FROM dhw_schedule WHERE date = ? ORDER BY hour',
		date
	);

	return rows.map(row => ({
		hour: row.hour,
		planned_temp: row.planned_temp,
		price_cent_kwh: row.price_cent_kwh,
		reason: row.reason
	}));
}

/**
 * Get the planned DHW temperature for a specific hour
 */
export async function getPlannedDHWTempForHour(
	db: Database,
	date: string,
	hour: number
): Promise<number | null> {
	const row = await db.get<{ planned_temp: number }>(
		'SELECT planned_temp FROM dhw_schedule WHERE date = ? AND hour = ?',
		date,
		hour
	);
	return row?.planned_temp ?? null;
}

/**
 * Mark a DHW scheduled hour as applied
 */
export async function markDHWScheduleApplied(
	db: Database,
	date: string,
	hour: number
): Promise<void> {
	await db.run(
		`UPDATE dhw_schedule SET applied_at = datetime('now') WHERE date = ? AND hour = ?`,
		date,
		hour
	);
}

/**
 * Get the full daily schedule (heating + DHW)
 */
export async function getDailySchedule(
	db: Database,
	date: string
): Promise<DailySchedule | null> {
	const heating = await getHeatingScheduleForDate(db, date);
	const dhw = await getDHWScheduleForDate(db, date);

	if (heating.length === 0 && dhw.length === 0) {
		return null;
	}

	return {
		date,
		heating,
		dhw
	};
}

/**
 * Clean up old schedules (older than 7 days)
 */
export async function cleanupOldSchedules(db: Database): Promise<void> {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - 7);
	const cutoffStr = cutoff.toISOString().split('T')[0];

	await db.run('DELETE FROM heating_schedule WHERE date < ?', cutoffStr);
	await db.run('DELETE FROM dhw_schedule WHERE date < ?', cutoffStr);
}
