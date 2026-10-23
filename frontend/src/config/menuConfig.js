/**
 * BWORK-POS Central Menu & Permission Label Configuration
 * Single Source of Truth for Navigation Labels and Role Permission Management.
 *
 * Rules:
 * - Exact match to Sidebar & Navigation labels
 * - Preserves existing Permission Keys / Database IDs without alteration
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
      { key: 'quotations', label: 'Quotations' }
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
      { key: 'admin-backup', label: 'สำรองข้อมูล (Backup)' }
    ]
  }
];

export const ALL_PERMISSION_MENUS = PERMISSION_GROUPS.flatMap(g => g.menus);

/**
 * Navigation items currently governed by role or composite permissions,
 * recorded as system Gaps for future permission architecture updates.
 */
export const UNMAPPED_NAVIGATION_ITEMS = [
  {
    id: 'hour-credits',
    label: 'Hour Credits',
    currentAuthorization: 'tied to pos permission in checkUserPermission',
    status: 'gap'
  },
  {
    id: 'customers',
    label: 'จัดการลูกค้า',
    currentAuthorization: 'pos || manage || history || customers || admin-management',
    status: 'gap'
  },
  {
    id: 'tickets',
    label: 'แจ้งปัญหา',
    currentAuthorization: 'pos || manage || pending || tickets || admin-management',
    status: 'gap'
  },
  {
    id: 'dooraccess',
    label: 'ระบบจอง LINE & รหัสเข้าห้อง',
    currentAuthorization: 'admin-management || admin-dooraccess',
    status: 'gap'
  },
  {
    id: 'general',
    label: 'ทั่วไป',
    currentAuthorization: 'admin-management',
    status: 'gap'
  }
];

export default {
  PERMISSION_GROUPS,
  ALL_PERMISSION_MENUS,
  UNMAPPED_NAVIGATION_ITEMS
};
