/**
 * BWORK-POS Central Menu & Permission Configuration
 * Single Source of Truth for Navigation Labels and Role Permission Management.
 *
 * Rules:
 * - Exact match to Sidebar & Navigation labels
 * - Standardized permission keys across Frontend, Backend, and Database
 */

export const PERMISSION_GROUPS = [
  {
    groupId: 'main',
    groupName: 'เมนูหลัก (Main Navigation)',
    menus: [
      { key: 'dashboard', label: 'Today Overview' },
      { key: 'pos', label: 'POS' },
      { key: 'pending', label: 'Booking Management' },
      { key: 'layout', label: 'Rooms' },
      { key: 'history', label: 'Booking History' },
      { key: 'quotations', label: 'Quotations' },
      { key: 'hour-credits', label: 'Hour Credits' },
      { key: 'customers', label: 'จัดการลูกค้า' },
      { key: 'tickets', label: 'แจ้งปัญหา' }
    ]
  },
  {
    groupId: 'settings',
    groupName: 'ตั้งค่าระบบ (Settings)',
    menus: [
      { key: 'manage', label: 'จัดการคลังสินค้า' },
      { key: 'admin-users', label: 'จัดการผู้ใช้ & บทบาท' },
      { key: 'admin-system', label: 'ตั้งค่าระบบ & ใบเสร็จ' },
      { key: 'admin-promotion', label: 'ตั้งค่าโปรโมชั่น' },
      { key: 'admin-quotation', label: 'ตั้งค่าใบเสนอราคา' },
      { key: 'admin-backup', label: 'สำรองข้อมูล (Backup)' },
      { key: 'admin-dooraccess', label: 'ระบบจอง LINE & รหัสเข้าห้อง' },
      { key: 'admin-general', label: 'ทั่วไป' }
    ]
  }
];

export const ALL_PERMISSION_MENUS = PERMISSION_GROUPS.flatMap(g => g.menus);

export const DEFAULT_ADMIN_PERMISSIONS = ALL_PERMISSION_MENUS.map(m => m.key);

export const DEFAULT_STAFF_PERMISSIONS = [
  'pos',
  'pending',
  'layout',
  'history',
  'quotations',
  'hour-credits',
  'customers',
  'tickets'
];

export default {
  PERMISSION_GROUPS,
  ALL_PERMISSION_MENUS,
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS
};
