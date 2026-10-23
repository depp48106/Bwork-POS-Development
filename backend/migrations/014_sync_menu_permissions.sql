-- Migration 014: Synchronize Menu-Level Permissions Across System Roles
-- BWORK-POS-MENU-PERMISSIONS-V2

-- 1. Update Admin system role to include all 17 navigation permissions
UPDATE roles
SET permissions = 'pos,dashboard,pending,layout,history,quotations,hour-credits,customers,tickets,manage,admin-users,admin-system,admin-promotion,admin-quotation,admin-backup,admin-dooraccess,admin-general'
WHERE name = 'admin';

-- 2. Update Staff system role to include independent main navigation keys (backward-compatible)
UPDATE roles
SET permissions = 'pos,pending,layout,history,quotations,hour-credits,customers,tickets'
WHERE name = 'staff';

-- 3. Update existing admin user record with complete permission suite
UPDATE users
SET permissions = 'pos,dashboard,pending,layout,history,quotations,hour-credits,customers,tickets,manage,admin-users,admin-system,admin-promotion,admin-quotation,admin-backup,admin-dooraccess,admin-general'
WHERE username = 'admin' OR role = 'admin';

-- 4. Update existing staff user records to retain access to Hour Credits, CRM, and Tickets
UPDATE users
SET permissions = 'pos,pending,layout,history,quotations,hour-credits,customers,tickets'
WHERE (role = 'staff' OR username = 'staff') AND (permissions IS NULL OR permissions = 'pos,pending,layout,history,quotations');
