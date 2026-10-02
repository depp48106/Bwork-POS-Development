-- Migration 008: Add discount, deposit, and payment ledger support
-- BWORK-DISCOUNT-DEPOSIT-V1

-- 1. Ensure payment_transactions table exists for local SQLite / fresh installs
-- Note: Base definition matches Production D1 baseline without transaction_type
CREATE TABLE IF NOT EXISTS payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL,
  slip_url TEXT,
  status TEXT DEFAULT 'completed',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Add transaction_type to payment_transactions (deposit, balance, full)
ALTER TABLE payment_transactions ADD COLUMN transaction_type TEXT DEFAULT 'full';

-- 3. Add financial snapshot columns to bookings table
ALTER TABLE bookings ADD COLUMN subtotal_amount REAL;
ALTER TABLE bookings ADD COLUMN discount_type TEXT DEFAULT 'none';
ALTER TABLE bookings ADD COLUMN discount_value REAL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN discount_amount REAL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN paid_amount REAL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN balance_amount REAL DEFAULT 0;

-- 4. Create performance indexes
CREATE INDEX IF NOT EXISTS idx_payment_transactions_booking_id ON payment_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_bookings_balance_amount ON bookings(balance_amount);

-- 5. Safe backfill for legacy bookings
-- Populate subtotal_amount and zero discount for existing rows
UPDATE bookings
SET subtotal_amount = total_amount,
    discount_type = 'none',
    discount_value = 0,
    discount_amount = 0
WHERE subtotal_amount IS NULL;

-- Backfill paid_amount and balance_amount:
-- A. Paid: 100% paid, 0 balance
UPDATE bookings
SET paid_amount = total_amount,
    balance_amount = 0
WHERE payment_status = 'paid' AND (paid_amount IS NULL OR paid_amount = 0);

-- B. Internal free (Builtland): 0 paid, 0 balance
UPDATE bookings
SET paid_amount = 0,
    balance_amount = 0
WHERE payment_status = 'internal_free';

-- C. Pending / Reviewing / Rejected / Unpaid: 0 paid, balance = total_amount
UPDATE bookings
SET paid_amount = 0,
    balance_amount = total_amount
WHERE payment_status IN ('pending', 'reviewing', 'rejected', 'unpaid')
  AND (balance_amount IS NULL OR balance_amount = 0);

-- D. Cancelled / Failed: preserve contractual balance, paid = 0, balance = total_amount
UPDATE bookings
SET paid_amount = 0,
    balance_amount = total_amount
WHERE payment_status IN ('cancelled', 'failed')
  AND (balance_amount IS NULL OR balance_amount = 0);

-- E. Catch-all for any remaining rows with NULL paid or balance
UPDATE bookings
SET paid_amount = 0,
    balance_amount = total_amount
WHERE paid_amount IS NULL OR balance_amount IS NULL;

-- F. Backfill existing payment_transactions without transaction_type
UPDATE payment_transactions
SET transaction_type = 'full'
WHERE transaction_type IS NULL;
