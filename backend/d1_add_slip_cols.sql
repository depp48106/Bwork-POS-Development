ALTER TABLE bookings ADD COLUMN slip_trans_ref TEXT;
ALTER TABLE bookings ADD COLUMN slip_verified_at DATETIME;
ALTER TABLE bookings ADD COLUMN slip_verify_status TEXT;
CREATE INDEX IF NOT EXISTS idx_bookings_slip_trans_ref ON bookings(slip_trans_ref);
