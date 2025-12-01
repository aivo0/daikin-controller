import type { Settings, PriceData, DeviceState, ControlLogEntry, DaikinTokens } from '$lib/types';

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
		dhw_min_temp: parseFloat(settingsMap.get('dhw_min_temp') || '42'),
		dhw_target_temp: parseFloat(settingsMap.get('dhw_target_temp') || '55')
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
		`INSERT INTO device_state (timestamp, device_id, room_temp, target_temp, water_temp, outdoor_temp, target_offset, mode, power_on, price_cent_kwh, action_taken, dhw_tank_temp, dhw_target_temp, dhw_action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
		state.dhw_action ?? null
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
	}>('SELECT device_id, room_temp, target_temp, water_temp, outdoor_temp, target_offset, mode, power_on, timestamp, dhw_tank_temp, dhw_target_temp, dhw_action FROM device_state ORDER BY timestamp DESC LIMIT 1');

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
		dhw_action: row.dhw_action ?? undefined
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
		dhw_action: row.dhw_action ?? undefined
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
