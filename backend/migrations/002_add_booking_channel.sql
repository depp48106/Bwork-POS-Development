-- Migration 002: Add booking_channel column and backfill existing records
ALTER TABLE bookings ADD COLUMN booking_channel TEXT DEFAULT 'pos_web';

-- Backfill existing records:
-- 1. Online / LINE bookings:
UPDATE bookings
SET booking_channel = 'line_oa', customer_type = 'general'
WHERE booking_source = 'online' OR line_user_id IS NOT NULL;

-- 2. POS Walk-in bookings without specific customer_type:
UPDATE bookings
SET booking_channel = 'pos_web', customer_type = 'walkin'
WHERE (booking_source = 'walk-in' OR booking_source IS NULL)
  AND (customer_type IS NULL OR customer_type = '');

-- 3. Ensure Index for fast queries by booking_channel and customer_type
CREATE INDEX IF NOT EXISTS idx_bookings_channel_type ON bookings (booking_channel, customer_type);
