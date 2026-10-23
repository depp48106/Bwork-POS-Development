-- Migration 013: Add Tax Invoices and POS Payment Slip Management
-- BWORK-POS-TAX-INVOICES-AND-SLIP-V1

-- 1. Add enhanced tax invoice columns to bookings table
ALTER TABLE bookings ADD COLUMN tax_payer_type TEXT DEFAULT 'corporate';
ALTER TABLE bookings ADD COLUMN tax_branch_type TEXT DEFAULT 'head';
ALTER TABLE bookings ADD COLUMN tax_branch_number TEXT;
ALTER TABLE bookings ADD COLUMN tax_email TEXT;
ALTER TABLE bookings ADD COLUMN tax_invoice_status TEXT DEFAULT 'pending';

-- 2. Add slip_url column to payment_transactions table for ledger attachment
ALTER TABLE payment_transactions ADD COLUMN slip_url TEXT;

-- 3. Create tax_invoices table for issued tax invoice documents & versions
CREATE TABLE IF NOT EXISTS tax_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  invoice_number TEXT,
  tax_payer_type TEXT DEFAULT 'corporate',
  tax_name TEXT NOT NULL,
  tax_id TEXT NOT NULL,
  tax_branch_type TEXT DEFAULT 'head',
  tax_branch_number TEXT,
  tax_address TEXT,
  tax_email TEXT,
  tax_phone TEXT,
  file_url TEXT,
  r2_object_key TEXT,
  file_name TEXT,
  content_type TEXT,
  file_size INTEGER,
  status TEXT DEFAULT 'issued',
  notes TEXT,
  uploaded_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Performance & lookup indexes
CREATE INDEX IF NOT EXISTS idx_tax_invoices_booking_id ON tax_invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_invoice_number ON tax_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_bookings_tax_invoice_req ON bookings(tax_invoice_required);
CREATE INDEX IF NOT EXISTS idx_bookings_tax_invoice_status ON bookings(tax_invoice_status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_slip ON payment_transactions(slip_url);
