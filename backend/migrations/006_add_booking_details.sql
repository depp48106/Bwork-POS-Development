-- Migration 006: Add booking_details column
ALTER TABLE bookings ADD COLUMN booking_details TEXT;
