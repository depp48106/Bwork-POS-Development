ALTER TABLE bookings ADD COLUMN customer_type TEXT DEFAULT 'walkin';
ALTER TABLE bookings ADD COLUMN basecamp_sub_type TEXT;
ALTER TABLE bookings ADD COLUMN basecamp_unit TEXT;
ALTER TABLE bookings ADD COLUMN internal_department TEXT;
ALTER TABLE bookings ADD COLUMN billing_option TEXT DEFAULT 'paid';
ALTER TABLE bookings ADD COLUMN quota_hours_used REAL DEFAULT 0;
