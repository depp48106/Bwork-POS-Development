-- ==============================================================================
-- BWORK-POS MIGRATION 010: Room Image Position (Focal Point)
-- Status: APPROVED (Development Phase 3D)
-- Target: SQLite (database_dev.sqlite) / Cloudflare D1 (rooms table)
-- ==============================================================================

-- 1. Add Room Image Focal Position X (Horizontal percentage 0 - 100, Default 50 = Center)
ALTER TABLE rooms ADD COLUMN image_position_x INTEGER DEFAULT 50;

-- 2. Add Room Image Focal Position Y (Vertical percentage 0 - 100, Default 50 = Center)
ALTER TABLE rooms ADD COLUMN image_position_y INTEGER DEFAULT 50;
