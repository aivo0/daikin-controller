-- Better Auth tables
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER DEFAULT 0,
  image TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  expiresAt TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_session_userId ON session(userId);
CREATE INDEX IF NOT EXISTS idx_account_userId ON account(userId);

-- Electricity prices cache
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL UNIQUE,
  price_eur_mwh REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prices_timestamp ON prices(timestamp);

-- Device state history (for tracking and ML predictions)
CREATE TABLE IF NOT EXISTS device_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  device_id TEXT NOT NULL,
  water_temp REAL,
  outdoor_temp REAL,
  target_offset REAL,
  mode TEXT,
  power_on INTEGER,
  price_cent_kwh REAL,
  action_taken TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_device_state_timestamp ON device_state(timestamp);
CREATE INDEX IF NOT EXISTS idx_device_state_user_id ON device_state(user_id);

-- Global settings (for shared defaults, legacy support)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Per-user settings (key-value store)
CREATE TABLE IF NOT EXISTS user_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- OAuth tokens for Daikin (legacy single-user, kept for migration)
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- Only one row
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Per-user Daikin OAuth tokens
CREATE TABLE IF NOT EXISTS user_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tokens_user_id ON user_tokens(user_id);

-- Control action log
CREATE TABLE IF NOT EXISTS control_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  price_eur_mwh REAL,
  old_target_temp REAL,
  new_target_temp REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_control_log_timestamp ON control_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_control_log_user_id ON control_log(user_id);

-- Weekly consumption data (14 weeks history)
CREATE TABLE IF NOT EXISTS weekly_consumption (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,  -- ISO date of week start (Monday)
  heating_kwh REAL,
  cooling_kwh REAL,
  dhw_kwh REAL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_consumption_week ON weekly_consumption(week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_consumption_user_id ON weekly_consumption(user_id);

-- Monthly consumption data (24 months history)
CREATE TABLE IF NOT EXISTS monthly_consumption (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  month TEXT NOT NULL,  -- YYYY-MM format
  heating_kwh REAL,
  cooling_kwh REAL,
  dhw_kwh REAL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_consumption_month ON monthly_consumption(month);
CREATE INDEX IF NOT EXISTS idx_monthly_consumption_user_id ON monthly_consumption(user_id);

-- Planned heating schedule (daily planning)
CREATE TABLE IF NOT EXISTS heating_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  hour INTEGER NOT NULL,           -- 0-23
  planned_offset INTEGER NOT NULL, -- -10 to +10
  outdoor_temp_forecast REAL,      -- Forecasted outdoor temp
  price_cent_kwh REAL,             -- Price for this hour
  reason TEXT,                     -- Human-readable explanation
  created_at TEXT DEFAULT (datetime('now')),
  applied_at TEXT,                 -- When actually applied
  UNIQUE(user_id, date, hour)
);

CREATE INDEX IF NOT EXISTS idx_heating_schedule_date ON heating_schedule(date);
CREATE INDEX IF NOT EXISTS idx_heating_schedule_user_date_hour ON heating_schedule(user_id, date, hour);

-- Planned DHW schedule (daily planning)
CREATE TABLE IF NOT EXISTS dhw_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  hour INTEGER NOT NULL,           -- 0-23
  planned_temp INTEGER NOT NULL,   -- 30-55
  price_cent_kwh REAL,             -- Price for this hour
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  applied_at TEXT,
  UNIQUE(user_id, date, hour)
);

CREATE INDEX IF NOT EXISTS idx_dhw_schedule_date ON dhw_schedule(date);
CREATE INDEX IF NOT EXISTS idx_dhw_schedule_user_id ON dhw_schedule(user_id);

-- Weather forecast cache
CREATE TABLE IF NOT EXISTS weather_forecast (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL UNIQUE,  -- ISO timestamp (hourly)
  temperature_2m REAL NOT NULL,    -- Outdoor temp forecast in Celsius
  fetched_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weather_forecast_timestamp ON weather_forecast(timestamp);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('min_temperature', '20'),
  ('base_temperature', '22'),
  ('boost_delta', '2'),
  ('reduce_delta', '2'),
  ('low_price_threshold', '5'),   -- c/kWh
  ('high_price_threshold', '15'), -- c/kWh
  ('cheapest_hours', '4'),
  ('peak_hours_to_avoid', '3'),
  ('strategies_enabled', '{"threshold":true,"cheapest":true,"peaks":true}'),
  -- New algorithm settings
  ('price_sensitivity', '7'),           -- K constant for offset calculation (1-10)
  ('cold_weather_threshold', '-5'),     -- Below this temp, reduce expensive penalties
  ('planning_hour', '15'),              -- Hour to run daily planning (after prices available)
  ('weather_location_lat', '59.3'),     -- Latitude for Luige alevik
  ('weather_location_lon', '24.7'),
  ('planning_needs_retry', 'false');    -- Set to true if planning fails, retry on next cron
