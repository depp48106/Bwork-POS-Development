-- Migration 003: Enhance slip unique index to prevent duplicate slip submissions
CREATE UNIQUE INDEX IF NOT EXISTS idx_slip_verifications_unique_approved 
ON slip_verifications(trans_ref) 
WHERE trans_ref IS NOT NULL AND verification_status IN ('passed', 'approved', 'auto_approved');
