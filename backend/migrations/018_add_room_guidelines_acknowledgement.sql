-- Migration 018: Add Room Guidelines Acknowledgement and LINE Deduplicated Dispatch
-- Preserves all previous migrations (001-017) without modification.

-- 1. Add guidelines acknowledgement columns to bookings table
ALTER TABLE bookings ADD COLUMN guidelines_acknowledged_at DATETIME;
ALTER TABLE bookings ADD COLUMN guidelines_rule_set TEXT;
ALTER TABLE bookings ADD COLUMN guidelines_rule_version TEXT;

-- 2. Create room_guidelines_acknowledgements table (stores per-booking acknowledgement)
CREATE TABLE IF NOT EXISTS room_guidelines_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id),
  rule_set TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  customer_contact TEXT,
  line_user_id TEXT,
  acknowledged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(booking_id, rule_set, rule_version)
);

CREATE INDEX IF NOT EXISTS idx_guidelines_ack_booking ON room_guidelines_acknowledgements(booking_id);
CREATE INDEX IF NOT EXISTS idx_guidelines_ack_contact ON room_guidelines_acknowledgements(customer_contact);
CREATE INDEX IF NOT EXISTS idx_guidelines_ack_line_user ON room_guidelines_acknowledgements(line_user_id);

-- 3. Create line_guidelines_dispatches table (stores deduplication per person x rule_set x rule_version)
CREATE TABLE IF NOT EXISTS line_guidelines_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL,
  rule_set TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  first_booking_id INTEGER REFERENCES bookings(id),
  status TEXT NOT NULL DEFAULT 'sent', -- 'claimed' | 'sent' | 'failed' | 'suppressed'
  error_message TEXT,
  dispatched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(line_user_id, rule_set, rule_version)
);

CREATE INDEX IF NOT EXISTS idx_line_guidelines_user ON line_guidelines_dispatches(line_user_id);

-- 4. Server Feature Toggle default setting (safe release preparation default: false)
INSERT OR IGNORE INTO settings (key, value) VALUES ('guidelines_enforcement_enabled', 'false');
