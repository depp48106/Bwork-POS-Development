ALTER TABLE rooms ADD COLUMN image_url TEXT;
ALTER TABLE rooms ADD COLUMN category TEXT DEFAULT 'Meeting Room';
ALTER TABLE rooms ADD COLUMN pin_code TEXT;
ALTER TABLE rooms ADD COLUMN daily_rate REAL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN half_day_rate REAL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN has_classroom INTEGER DEFAULT 0;
ALTER TABLE rooms ADD COLUMN classroom_hourly_rate REAL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN classroom_daily_rate REAL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN classroom_capacity INTEGER DEFAULT 0;
ALTER TABLE rooms ADD COLUMN classroom_image_url TEXT;
ALTER TABLE rooms ADD COLUMN has_hourly INTEGER DEFAULT 1;
ALTER TABLE rooms ADD COLUMN has_halfday INTEGER DEFAULT 0;
ALTER TABLE rooms ADD COLUMN has_daily INTEGER DEFAULT 0;

ALTER TABLE services ADD COLUMN image_url TEXT;

ALTER TABLE bookings ADD COLUMN pin_code TEXT;
ALTER TABLE bookings ADD COLUMN qr_token TEXT;
ALTER TABLE bookings ADD COLUMN line_user_id TEXT;
ALTER TABLE bookings ADD COLUMN checkin_status TEXT DEFAULT 'pending';
ALTER TABLE bookings ADD COLUMN checkin_at DATETIME;
ALTER TABLE bookings ADD COLUMN receipt_number TEXT;
ALTER TABLE bookings ADD COLUMN booking_source TEXT DEFAULT 'walk-in';
ALTER TABLE bookings ADD COLUMN slip_image_url TEXT;
ALTER TABLE bookings ADD COLUMN customer_email TEXT;

ALTER TABLE booking_items ADD COLUMN pin_code TEXT;
ALTER TABLE booking_items ADD COLUMN checkin_status TEXT DEFAULT 'pending';
ALTER TABLE booking_items ADD COLUMN checkin_at DATETIME;
ALTER TABLE booking_items ADD COLUMN layout TEXT DEFAULT 'standard';
ALTER TABLE booking_items ADD COLUMN booking_type TEXT DEFAULT 'hourly';

ALTER TABLE users ADD COLUMN permissions TEXT;
ALTER TABLE users ADD COLUMN fullname TEXT;
