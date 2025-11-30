-- Add new columns to device_state table
ALTER TABLE device_state ADD COLUMN outdoor_temp REAL;
ALTER TABLE device_state ADD COLUMN price_cent_kwh REAL;
ALTER TABLE device_state ADD COLUMN action_taken TEXT;

-- Rename columns (SQLite doesn't support direct rename, so we'll handle in code)
-- water_temp = room_temp, target_offset = target_temp

-- Add new settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('min_water_temp', '20'),
  ('target_water_temp', '32'),
  ('best_price_window_hours', '6');
