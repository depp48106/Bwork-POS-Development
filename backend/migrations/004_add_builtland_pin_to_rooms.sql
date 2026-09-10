-- Migration 004: Add builtland_pin_code to rooms table for Builtland employee room access
ALTER TABLE rooms ADD COLUMN builtland_pin_code TEXT;
