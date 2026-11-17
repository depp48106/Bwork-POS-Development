-- Migration 017: Add Tax Invoice Email Dispatch Tracking & Audit Log
-- Preserves all previous migrations (001-016) without modification.

-- 1. Add email dispatch tracking columns to tax_invoices table
ALTER TABLE tax_invoices ADD COLUMN email_status TEXT DEFAULT 'unsent';
ALTER TABLE tax_invoices ADD COLUMN email_sent_at DATETIME;
ALTER TABLE tax_invoices ADD COLUMN email_dry_run INTEGER DEFAULT 0;
ALTER TABLE tax_invoices ADD COLUMN email_message_id TEXT;
ALTER TABLE tax_invoices ADD COLUMN email_recipient TEXT;
ALTER TABLE tax_invoices ADD COLUMN email_error TEXT;

-- 2. Create tax_invoice_email_logs table for audit trail of email dispatches (dry-run & live)
CREATE TABLE IF NOT EXISTS tax_invoice_email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  tax_invoice_id INTEGER REFERENCES tax_invoices(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'dry_run', -- 'dry_run' | 'sent' | 'failed'
  is_dry_run INTEGER DEFAULT 1,
  message_id TEXT,
  file_name TEXT,
  file_size INTEGER,
  dispatched_by TEXT,
  payload_preview TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tax_invoice_email_logs_booking ON tax_invoice_email_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_tax_invoice_email_logs_status ON tax_invoice_email_logs(status);
