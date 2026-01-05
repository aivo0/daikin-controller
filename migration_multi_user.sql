-- Multi-user migration script
-- Run this AFTER the schema.sql changes have been applied to the database

-- Step 1: Create new tables if they don't exist
CREATE TABLE IF NOT EXISTS user_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

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

-- Step 2: Add user_id columns to existing tables (SQLite requires table recreation for NOT NULL constraints)
-- These will be nullable to support existing data

-- Note: In production, run these ALTER TABLE commands manually if tables already exist
-- ALTER TABLE device_state ADD COLUMN user_id TEXT REFERENCES user(id) ON DELETE CASCADE;
-- ALTER TABLE control_log ADD COLUMN user_id TEXT REFERENCES user(id) ON DELETE CASCADE;
-- ALTER TABLE weekly_consumption ADD COLUMN user_id TEXT REFERENCES user(id) ON DELETE CASCADE;
-- ALTER TABLE monthly_consumption ADD COLUMN user_id TEXT REFERENCES user(id) ON DELETE CASCADE;
-- ALTER TABLE heating_schedule ADD COLUMN user_id TEXT REFERENCES user(id) ON DELETE CASCADE;
-- ALTER TABLE dhw_schedule ADD COLUMN user_id TEXT REFERENCES user(id) ON DELETE CASCADE;

-- Step 3: Migrate existing data to first user
-- Get the first user's ID (you should verify this is your account)
-- Replace 'YOUR_USER_ID' with actual user ID from: SELECT id, email FROM user;

-- Migrate tokens from old single-row table to user_tokens
INSERT OR REPLACE INTO user_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
SELECT
  (SELECT id FROM user LIMIT 1),
  access_token,
  refresh_token,
  expires_at,
  updated_at
FROM tokens WHERE id = 1;

-- Migrate user-specific settings to user_settings
INSERT OR REPLACE INTO user_settings (user_id, key, value, updated_at)
SELECT
  (SELECT id FROM user LIMIT 1),
  key,
  value,
  updated_at
FROM settings
WHERE key IN (
  'price_sensitivity',
  'cold_weather_threshold',
  'planning_hour',
  'low_price_threshold',
  'dhw_min_temp',
  'dhw_target_temp',
  'weather_location_lat',
  'weather_location_lon',
  'planning_needs_retry'
);

-- Update existing records with first user's ID
UPDATE device_state SET user_id = (SELECT id FROM user LIMIT 1) WHERE user_id IS NULL;
UPDATE control_log SET user_id = (SELECT id FROM user LIMIT 1) WHERE user_id IS NULL;
UPDATE weekly_consumption SET user_id = (SELECT id FROM user LIMIT 1) WHERE user_id IS NULL;
UPDATE monthly_consumption SET user_id = (SELECT id FROM user LIMIT 1) WHERE user_id IS NULL;
UPDATE heating_schedule SET user_id = (SELECT id FROM user LIMIT 1) WHERE user_id IS NULL;
UPDATE dhw_schedule SET user_id = (SELECT id FROM user LIMIT 1) WHERE user_id IS NULL;

-- Create indexes on user_id columns
CREATE INDEX IF NOT EXISTS idx_device_state_user_id ON device_state(user_id);
CREATE INDEX IF NOT EXISTS idx_control_log_user_id ON control_log(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_consumption_user_id ON weekly_consumption(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_consumption_user_id ON monthly_consumption(user_id);
CREATE INDEX IF NOT EXISTS idx_heating_schedule_user_id ON heating_schedule(user_id);
CREATE INDEX IF NOT EXISTS idx_dhw_schedule_user_id ON dhw_schedule(user_id);

-- Verification queries (run manually to verify migration):
-- SELECT COUNT(*) as total, COUNT(user_id) as with_user FROM device_state;
-- SELECT COUNT(*) as total, COUNT(user_id) as with_user FROM control_log;
-- SELECT COUNT(*) FROM user_tokens;
-- SELECT COUNT(*) FROM user_settings;
