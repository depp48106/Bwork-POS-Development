// Safe public metadata (NO secrets, NO credentials, NO database/server paths)
export const APP_INFO = {
  name: import.meta.env.VITE_APP_NAME || 'Bwork-POS',
  version: import.meta.env.VITE_APP_VERSION || '1.1',
  buildDate: import.meta.env.VITE_BUILD_DATE || '2026-09-02',
  gitCommit: import.meta.env.VITE_GIT_COMMIT_SHORT || import.meta.env.VITE_GIT_COMMIT || '',
  developer: import.meta.env.VITE_DEVELOPER_NAME || 'Builtland'
};

export const RELEASE_NOTES = [
  {
    version: '1.1',
    date: '2026-09-02',
    isLatest: true,
    title: 'รายการจองห้อง & ปรับปรุงตารางและแถบแท็บ',
    highlights: [
      'แก้ไข Production API Routing ให้ POS Webapp เรียก Cloudflare Worker API ได้ถูกต้อง',
      'แก้ไขปัญหาหน้า Matrix แสดง 0 ห้องหลัง Deploy',
      'เพิ่มระบบทดสอบการเชื่อมต่อ LINE OA',
      'ปรับ LIFF ID ให้ดึงจาก Public Config',
      'ปรับ payment_window_minutes ให้เป็นค่ากลางจาก Settings',
      'ป้องกัน Token / Secret แสดงหรือถูกบันทึกทับด้วยค่า Mask',
      'ปรับปรุงหน้ารายการจองห้อง: จัดเรียงตาราง 9 คอลัมน์ ข้อมูลตรงกับหัวตารางทุกช่องอย่างเป็นระเบียบ',
      'จัดสัดส่วนความกว้างคอลัมน์ตาม Mock Layout: เลขที่ใบจอง 10%, ผู้จอง 18%, ประเภทลูกค้า 10%, ช่องทาง 8%, ห้องประชุม 14%, วันที่/เวลาใช้งาน 16%, ยอดชำระ 8%, รหัสเข้าห้อง 10%, การดำเนินการ 16%',
      'แยกแท็บด้านบน: นำแท็บ "ทั้งหมด" ออกจาก UI และคงแท็บทางการ 4 แท็บ (Walk-in, Builtland, Basecamp, LINE OA / Online)',
      'ลบ Emoji ออกจากชื่อแท็บ ปุ่ม และ Badge ในตาราง เพื่อให้รูปแบบดูสะอาด เรียบง่าย และเป็นทางการ',
      'เพิ่ม App Version Display ที่มุมขวาล่าง และหน้าต่าง Patch Notes สำหรับตรวจสอบเวอร์ชันการ Deploy'
    ]
  },
  {
    version: '1.2.2',
    date: '2026-09-01',
    isLatest: false,
    title: 'ระบบสถานะ Builtland & ปรับปรุงความถูกต้อง',
    highlights: [
      'ปรับปรุงระบบสถานะ Builtland และ Door PIN ประจำห้อง สำหรับการเข้าใช้งานของทีมงาน Builtland',
      'ปรับปรุง Search/Filter Toolbar ของหน้ารายการจองห้องให้อยู่ในบรรทัดเดียวกันบน Desktop',
      'แก้ไขการแสดงผลใบเสร็จรับเงินและการตรวจสอบสลิปย้อนหลัง'
    ]
  },
  {
    version: '1.2.1',
    date: '2026-08-28',
    isLatest: false,
    title: 'ระบบตรวจสอบสลิป & การแจ้งเตือน',
    highlights: [
      'เพิ่มแถบการแจ้งเตือนสลิปโอนเงินใหม่จากลูกค้าผ่าน LINE OA',
      'ปรับปรุงระบบกรองวันที่ใช้งาน (Usage Date) และวันที่ทำรายการ (Created At)',
      'ปรับปรุงประสิทธิภาพการดึงข้อมูลห้องประชุมและรายการจอง'
    ]
  }
];
