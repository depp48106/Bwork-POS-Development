-- Seed default data for Cloudflare D1 (rooms, services, settings, admin user)

INSERT INTO rooms (name, capacity, hourly_rate, daily_rate, half_day_rate, has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, description) VALUES 
('ห้องประชุม Saturn (201)', 4, 150.0, 1200.0, 600.0, 0, 0, 0, 0, 'ห้องประชุมขนาดเล็กส่วนตัว สำหรับ 1-4 ท่าน'),
('ห้องประชุม Venus (202)', 4, 150.0, 1200.0, 600.0, 0, 0, 0, 0, 'ห้องประชุมขนาดเล็กส่วนตัว สำหรับ 1-4 ท่าน'),
('ห้องประชุม Uranus (203)', 4, 150.0, 1200.0, 600.0, 0, 0, 0, 0, 'ห้องประชุมขนาดเล็กส่วนตัว สำหรับ 1-4 ท่าน'),
('ห้องประชุม Neptune (204)', 4, 150.0, 1200.0, 600.0, 0, 0, 0, 0, 'ห้องประชุมขนาดเล็กส่วนตัว สำหรับ 1-4 ท่าน'),
('ห้องประชุม Mars 301', 8, 400.0, 4000.0, 2000.0, 1, 700.0, 5000.0, 12, 'ห้องประชุมส่วนตัวปรับสลับจัดห้องแบบ classroom ได้ 12 ที่'),
('ห้องประชุม Mercury (302)', 10, 500.0, 4500.0, 2500.0, 0, 0, 0, 0, 'ห้องประชุมขนาดกลาง เหมาะสำหรับทีมงาน 8-10 ท่าน'),
('ห้องประชุม Pluto (305)', 12, 600.0, 5000.0, 2800.0, 0, 0, 0, 0, 'ห้องประชุมขนาดใหญ่ รองรับ 12 ท่าน'),
('ห้องประชุม Jupiter (300)', 30, 800.0, 6400.0, 6000.0, 0, 0, 0, 0, 'ห้องประชุมใหญ่โถงอเนกประสงค์');

INSERT INTO services (name, price, category) VALUES 
('กาแฟ & ชา ของว่าง (Catering Box)', 50.0, 'catering'),
('เครื่องดื่มน้ำสมุนไพร & น้ำดื่ม (Herb Drinks)', 30.0, 'catering'),
('เครื่องโปรเจคเตอร์ 4K (Projector Rental)', 100.0, 'equipment'),
('เจ้าหน้าที่เทคนิคประจำห้องประชุม (IT Technical Support)', 200.0, 'staff');

INSERT INTO settings (key, value) VALUES 
('company_name', 'บริษัท ดีพมายด์ โซลูชั่น จำกัด'),
('receipt_header', 'ใบเสร็จรับเงิน / ใบรับจองบริการ'),
('receipt_footer', 'ขอบคุณที่ใช้บริการห้องประชุมของเรา'),
('promptpay_id', '0125554000401'),
('payment_bank_name', 'ธนาคารกรุงศรีอยุธยา (Krungsri)'),
('payment_bank_account', '329-1-38429-0'),
('payment_bank_account_name', 'บริษัท บิลท์ ฮาร์ท จำกัด');

INSERT INTO users (username, password_hash, role, permissions, fullname) VALUES 
('admin', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'admin', 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation', 'ผู้ดูแลระบบหลัก');
