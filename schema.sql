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

-- User settings (key-value store)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- OAuth tokens for Daikin
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- Only one row
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Control action log
CREATE TABLE IF NOT EXISTS control_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  price_eur_mwh REAL,
  old_target_temp REAL,
  new_target_temp REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_control_log_timestamp ON control_log(timestamp);

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
  ('strategies_enabled', '{"threshold":true,"cheapest":true,"peaks":true}');
