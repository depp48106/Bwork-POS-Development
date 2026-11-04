-- Migration 016: Ensure legacy and non-tax booking records have tax_payer_type as NULL
-- Preserves all previous migrations (001-015) without alteration.
-- For bookings where tax invoice was not requested, or legacy records without entity selection,
-- sets tax_payer_type to NULL so historical records display as 'ไม่ระบุประเภท'.

UPDATE bookings
SET tax_payer_type = NULL
WHERE tax_invoice_required = 0 OR tax_invoice_required IS NULL;
