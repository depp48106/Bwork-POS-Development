UPDATE users SET permissions = 'pos,pending,layout,manage,history,quotations' WHERE role = 'staff' AND (permissions IS NULL OR permissions = '');
UPDATE users SET permissions = 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation' WHERE role = 'admin' AND (permissions IS NULL OR permissions = '');
