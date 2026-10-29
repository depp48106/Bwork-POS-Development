-- Migration 015: Add LINE Notification Claims Table for Atomic Idempotency
-- BWORK-POS-LINE-CONFIRMATION-ATOMIC-IDEMPOTENCY-V1

-- 1. Create table for atomic notification claims and outbox tracking
CREATE TABLE IF NOT EXISTS line_notification_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL DEFAULT 'booking_confirmation',
  status TEXT NOT NULL DEFAULT 'processing', -- 'processing', 'sent', 'failed', 'delivery_unknown'
  claim_token TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  http_status INTEGER,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(booking_id, notification_type)
);

-- 2. Performance and lookup index for atomic claim status checks
CREATE INDEX IF NOT EXISTS idx_line_claims_booking_status 
ON line_notification_claims (booking_id, notification_type, status);
