PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE _schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT UNIQUE NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "_schema_migrations" ("id","version","applied_at") VALUES(1,'001_core_schema.sql','2026-10-12 17:53:10');
INSERT INTO "_schema_migrations" ("id","version","applied_at") VALUES(2,'002_add_booking_channel.sql','2026-10-12 17:53:10');
INSERT INTO "_schema_migrations" ("id","version","applied_at") VALUES(3,'003_slip_unique_index.sql','2026-10-12 17:53:10');
INSERT INTO "_schema_migrations" ("id","version","applied_at") VALUES(4,'004_add_builtland_pin_to_rooms.sql','2026-10-12 17:53:10');
INSERT INTO "_schema_migrations" ("id","version","applied_at") VALUES(5,'005_room_hour_credits.sql','2026-10-12 17:53:10');
INSERT INTO "_schema_migrations" ("id","version","applied_at") VALUES(6,'006_add_booking_details.sql','2026-10-12 17:53:10');
INSERT INTO "_schema_migrations" ("id","version","applied_at") VALUES(7,'007_add_builtland_pin_to_rooms.sql','2026-10-12 17:53:10');
INSERT INTO "_schema_migrations" ("id","version","applied_at") VALUES(8,'008_add_discount_and_deposit.sql','2026-10-12 17:53:10');
INSERT INTO "_schema_migrations" ("id","version","applied_at") VALUES(9,'009_add_room_wifi_credentials.sql','2026-10-12 17:53:10');
CREATE TABLE rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  hourly_rate REAL NOT NULL,
  daily_rate REAL DEFAULT 0,
  half_day_rate REAL DEFAULT 0,
  has_classroom INTEGER DEFAULT 0,
  classroom_hourly_rate REAL DEFAULT 0,
  classroom_daily_rate REAL DEFAULT 0,
  classroom_capacity INTEGER DEFAULT 0,
  classroom_image_url TEXT,
  description TEXT,
  status TEXT DEFAULT 'active',
  image_url TEXT,
  has_hourly INTEGER DEFAULT 1,
  has_halfday INTEGER DEFAULT 0,
  has_daily INTEGER DEFAULT 0,
  category TEXT DEFAULT 'Meeting Room',
  pin_code TEXT,
  builtland_pin_code TEXT,
  wifi_username TEXT,
  wifi_password_enc TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "rooms" ("id","name","capacity","hourly_rate","daily_rate","half_day_rate","has_classroom","classroom_hourly_rate","classroom_daily_rate","classroom_capacity","classroom_image_url","description","status","image_url","has_hourly","has_halfday","has_daily","category","pin_code","builtland_pin_code","wifi_username","wifi_password_enc","created_at") VALUES(4,'Mars (301)',8,350,4000,0,1,700,5000,12,NULL,'ห้องประชุมขนาด 8 ท่าน (Staging)','active','data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',1,0,1,'Meeting Room','654321','888321','room_mars_user','v1:030491a94ad6c272dc12d3f4:feb2c887f79403839b0cea0498f452f4:8c3611034a39b8cd6af9c5761fefc92b221f9d13','2026-10-12 17:53:10');
INSERT INTO "rooms" ("id","name","capacity","hourly_rate","daily_rate","half_day_rate","has_classroom","classroom_hourly_rate","classroom_daily_rate","classroom_capacity","classroom_image_url","description","status","image_url","has_hourly","has_halfday","has_daily","category","pin_code","builtland_pin_code","wifi_username","wifi_password_enc","created_at") VALUES(5,'Mercury (302)',10,350,4000,0,0,0,0,0,NULL,'ห้องประชุมขนาดกลาง 10 ท่าน พร้อม Wi-Fi สำหรับทดสอบ (Staging)','active',NULL,1,0,1,'Meeting Room','970491#','BL-302','staging_room_302','v1:9c5e6a4a4f12a313aca96b6f:059d8f81e19c7a75e557c96bd5d63c4d:142e70f18c03dd4b6aef8c73c170ca','2026-10-12 17:53:10');
INSERT INTO "rooms" ("id","name","capacity","hourly_rate","daily_rate","half_day_rate","has_classroom","classroom_hourly_rate","classroom_daily_rate","classroom_capacity","classroom_image_url","description","status","image_url","has_hourly","has_halfday","has_daily","category","pin_code","builtland_pin_code","wifi_username","wifi_password_enc","created_at") VALUES(6,'Saturn (303)',4,300,2200,0,0,0,0,0,NULL,'ห้องประชุมขนาดเล็ก 4 ท่าน (Staging)','active','/uploads/img_1784255104724_sitlj.png',1,0,1,'Meeting Room','812187#','BL-303','staging_room_303','v1:055606fb893d51f8081fb3fd:907a9ff07985e46c44a72ab228f082e4:ff437a4d10d7aa79c681fdb71b96','2026-10-12 17:53:10');
INSERT INTO "rooms" ("id","name","capacity","hourly_rate","daily_rate","half_day_rate","has_classroom","classroom_hourly_rate","classroom_daily_rate","classroom_capacity","classroom_image_url","description","status","image_url","has_hourly","has_halfday","has_daily","category","pin_code","builtland_pin_code","wifi_username","wifi_password_enc","created_at") VALUES(7,'Venus (304)',4,200,1500,0,0,0,0,0,NULL,'ห้องประชุมขนาดเล็ก 4 ท่าน (Staging)','active',NULL,1,0,1,'Meeting Room','593105#','BL-304',NULL,NULL,'2026-10-12 17:53:10');
INSERT INTO "rooms" ("id","name","capacity","hourly_rate","daily_rate","half_day_rate","has_classroom","classroom_hourly_rate","classroom_daily_rate","classroom_capacity","classroom_image_url","description","status","image_url","has_hourly","has_halfday","has_daily","category","pin_code","builtland_pin_code","wifi_username","wifi_password_enc","created_at") VALUES(8,'Uranus (305)',4,200,1500,0,0,0,0,0,NULL,'ห้องประชุมขนาดเล็ก 4 ท่าน (Staging)','active','/uploads/img_1784255113580_621zu.png',1,0,1,'Meeting Room','139231#','BL-305',NULL,NULL,'2026-10-12 17:53:10');
INSERT INTO "rooms" ("id","name","capacity","hourly_rate","daily_rate","half_day_rate","has_classroom","classroom_hourly_rate","classroom_daily_rate","classroom_capacity","classroom_image_url","description","status","image_url","has_hourly","has_halfday","has_daily","category","pin_code","builtland_pin_code","wifi_username","wifi_password_enc","created_at") VALUES(9,'Neptune (306)',4,200,1500,0,0,0,0,0,NULL,'ห้องประชุมขนาดเล็ก 4 ท่าน (Staging)','active','/uploads/img_1784255180854_po1xb.jpeg',1,0,1,'Meeting Room','593105#','BL-306',NULL,NULL,'2026-10-12 17:53:10');
INSERT INTO "rooms" ("id","name","capacity","hourly_rate","daily_rate","half_day_rate","has_classroom","classroom_hourly_rate","classroom_daily_rate","classroom_capacity","classroom_image_url","description","status","image_url","has_hourly","has_halfday","has_daily","category","pin_code","builtland_pin_code","wifi_username","wifi_password_enc","created_at") VALUES(10,'Jupiter (300)',40,1700,12000,6000,0,0,0,0,NULL,'ห้องประชุมโถงใหญ่ 40 ท่าน (Staging)','active',NULL,1,1,1,'Meeting Room',NULL,NULL,'staging_jupiter_300','v1:728e364e1e448ef0e088e999:64cae2107e05ad06456aed9fe2900f31:1038cb79ba0bd31dc80cace76c3737ff08','2026-10-12 17:53:10');
INSERT INTO "rooms" ("id","name","capacity","hourly_rate","daily_rate","half_day_rate","has_classroom","classroom_hourly_rate","classroom_daily_rate","classroom_capacity","classroom_image_url","description","status","image_url","has_hourly","has_halfday","has_daily","category","pin_code","builtland_pin_code","wifi_username","wifi_password_enc","created_at") VALUES(11,'Pluto (201)',12,600,5000,0,0,0,0,0,NULL,'ห้องประชุม 12 ท่าน (Staging)','active','/uploads/img_1784255327701_aw4w5.jpeg',1,0,1,'Meeting Room','765297#','BL-201',NULL,NULL,'2026-10-12 17:53:10');
CREATE TABLE services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  category TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  image_url TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "services" ("id","name","price","category","status","image_url","description","created_at") VALUES(1,'กาแฟ & ชา ของว่าง (Catering Box - Staging)',50,'catering','active',NULL,NULL,'2026-10-12 17:53:10');
INSERT INTO "services" ("id","name","price","category","status","image_url","description","created_at") VALUES(2,'เครื่องโปรเจคเตอร์ 4K (Projector Rental - Staging)',100,'equipment','active',NULL,NULL,'2026-10-12 17:53:10');
CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  department TEXT,
  contact TEXT,
  total_amount REAL NOT NULL,
  payment_status TEXT DEFAULT 'pending',
  payment_method TEXT,
  receipt_number TEXT,
  pin_code TEXT,
  qr_token TEXT,
  line_user_id TEXT,
  booking_source TEXT DEFAULT 'online',
  customer_email TEXT,
  booking_details TEXT,
  slip_image_url TEXT,
  checkin_status TEXT DEFAULT 'pending',
  checkin_at DATETIME,
  tax_invoice_required INTEGER DEFAULT 0,
  tax_name TEXT,
  tax_address TEXT,
  tax_id TEXT,
  tax_phone TEXT,
  tax_delivery_method TEXT,
  tax_postal_address TEXT,
  guest_count INTEGER,
  customer_type TEXT DEFAULT 'walkin',
  basecamp_sub_type TEXT,
  basecamp_unit TEXT,
  internal_department TEXT,
  billing_option TEXT DEFAULT 'paid',
  quota_hours_used REAL DEFAULT 0,
  subtotal_amount REAL,
  discount_type TEXT DEFAULT 'none',
  discount_value REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  balance_amount REAL DEFAULT 0,
  slip_trans_ref TEXT,
  slip_verified_at TEXT,
  slip_verify_status TEXT,
  cancellation_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9001,'ผู้ทดสอบ สเตจจิ้ง 1 (Single Item Test)',NULL,'0800000001',1000,'paid','promptpay','REC-STAGE-9001','970491#',NULL,NULL,'online',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'walkin',NULL,NULL,NULL,'paid',0,1000,'none',0,0,1000,0,NULL,NULL,NULL,NULL,'2026-10-20 08:00:00');
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9002,'ผู้ทดสอบ สเตจจิ้ง 2 (Multi Room Test)',NULL,'0800000002',2600,'deposit','promptpay','REC-STAGE-9002','970491#',NULL,NULL,'pos',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'walkin',NULL,NULL,NULL,'paid',0,2600,'none',0,0,1000,1600,NULL,NULL,NULL,NULL,'2026-10-21 08:00:00');
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9003,'ผู้ทดสอบ สเตจจิ้ง 3 (Conflict Test)',NULL,'0800000003',1000,'cancelled','promptpay','REC-STAGE-9003','987654#',NULL,NULL,'online',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'walkin',NULL,NULL,NULL,'paid',0,1000,'none',0,0,0,1000,NULL,NULL,NULL,NULL,'2026-10-22 08:00:00');
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9004,'ลูกค้าทดสอบ (ไม่ระบุเบอร์โทร / ห้องไม่มีรูป)',NULL,NULL,800,'paid','promptpay','REC-STAGE-9004','593105#',NULL,NULL,'pos',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'walkin',NULL,NULL,NULL,'paid',0,800,'none',0,0,800,0,NULL,NULL,NULL,NULL,'2026-10-23 09:00:00');
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9005,'ssss','','',600,'paid','cash','BK-2610001','765297#',NULL,NULL,'walkin',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'walkin',NULL,NULL,NULL,'paid',0,600,'none',0,0,600,0,NULL,NULL,NULL,NULL,'2026-10-13T07:45:14.128Z');
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9501,'Basecamp Office 401 (Normal)',NULL,NULL,0,'paid',NULL,NULL,NULL,NULL,NULL,'online',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'basecamp','office','401',NULL,'paid',1,NULL,'none',0,0,0,0,NULL,NULL,NULL,NULL,'2026-10-25 09:00:00');
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9502,'Basecamp Hotdesk 419 (Low)',NULL,NULL,0,'paid',NULL,NULL,NULL,NULL,NULL,'online',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'basecamp','hotdesk','419',NULL,'paid',1,NULL,'none',0,0,0,0,NULL,NULL,NULL,NULL,'2026-10-25 10:00:00');
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9503,'Basecamp Office 402 (Depleted)',NULL,NULL,0,'paid',NULL,NULL,NULL,NULL,NULL,'online',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'basecamp','office','402',NULL,'paid',4,NULL,'none',0,0,0,0,NULL,NULL,NULL,NULL,'2026-10-26 09:00:00');
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9504,'Basecamp Multi-Room Unit 403',NULL,NULL,0,'paid',NULL,NULL,NULL,NULL,NULL,'online',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'basecamp','office','403',NULL,'paid',2,NULL,'none',0,0,0,0,NULL,NULL,NULL,NULL,'2026-10-27 09:00:00');
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9505,'Basecamp Cancelled Unit 404',NULL,NULL,0,'cancelled',NULL,NULL,NULL,NULL,NULL,'online',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'basecamp','office','404',NULL,'paid',2,NULL,'none',0,0,0,0,NULL,NULL,NULL,NULL,'2026-10-28 09:00:00');
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9506,'Basecamp Missing Unit Tenant',NULL,NULL,0,'paid',NULL,NULL,NULL,NULL,NULL,'online',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'basecamp','office',NULL,NULL,'paid',1,NULL,'none',0,0,0,0,NULL,NULL,NULL,NULL,'2026-10-29 09:00:00');
INSERT INTO "bookings" ("id","customer_name","department","contact","total_amount","payment_status","payment_method","receipt_number","pin_code","qr_token","line_user_id","booking_source","customer_email","booking_details","slip_image_url","checkin_status","checkin_at","tax_invoice_required","tax_name","tax_address","tax_id","tax_phone","tax_delivery_method","tax_postal_address","guest_count","customer_type","basecamp_sub_type","basecamp_unit","internal_department","billing_option","quota_hours_used","subtotal_amount","discount_type","discount_value","discount_amount","paid_amount","balance_amount","slip_trans_ref","slip_verified_at","slip_verify_status","cancellation_reason","created_at") VALUES(9507,'Regular Walkin Customer',NULL,NULL,500,'paid',NULL,NULL,NULL,NULL,NULL,'online',NULL,NULL,NULL,'pending',NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'walkin',NULL,NULL,NULL,'paid',0,NULL,'none',0,0,0,0,NULL,NULL,NULL,NULL,'2026-10-30 09:00:00');
CREATE TABLE booking_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id),
  service_id INTEGER REFERENCES services(id),
  quantity INTEGER DEFAULT 1,
  price REAL NOT NULL,
  start_time TEXT,
  end_time TEXT,
  subtotal REAL NOT NULL,
  layout TEXT DEFAULT 'standard',
  booking_type TEXT DEFAULT 'hourly',
  guest_count INTEGER,
  pin_code TEXT,
  checkin_status TEXT DEFAULT 'pending',
  checkin_at DATETIME
);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9101,9001,5,NULL,1,500,'2026-10-20T10:00:00','2026-10-20T12:00:00',1000,'standard','hourly',NULL,'970491#','pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9102,9002,5,NULL,1,500,'2026-10-21T07:00:00','2026-10-21T09:00:00',1000,'standard','hourly',NULL,'970491#','pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9103,9002,6,NULL,1,300,'2026-10-21T14:00:00','2026-10-21T16:00:00',600,'standard','hourly',NULL,'812187#','pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9104,9003,5,NULL,1,500,'2026-10-22 14:00','2026-10-22 16:00',1000,'standard','hourly',NULL,'987654#','pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9105,9002,4,NULL,1,500,'2026-10-21T15:30:00','2026-10-21T17:30:00',1000,'standard','hourly',NULL,'654321','pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9106,9004,7,NULL,2,400,'2026-10-23T10:00:00','2026-10-23T12:00:00',800,'standard','hourly',NULL,'593105#','pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9107,9005,11,NULL,1,600,'2026-10-13T15:00:00','2026-10-13T16:00:00',600,'standard','hourly',NULL,'765297#','pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9511,9501,4,NULL,1,0,'2026-10-25T09:00:00','2026-10-25T10:00:00',0,'standard','hourly',NULL,NULL,'pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9512,9502,5,NULL,1,0,'2026-10-25T10:00:00','2026-10-25T11:00:00',0,'standard','hourly',NULL,NULL,'pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9513,9503,4,NULL,1,0,'2026-10-26T09:00:00','2026-10-26T13:00:00',0,'standard','hourly',NULL,NULL,'pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9514,9504,4,NULL,1,0,'2026-10-27T09:00:00','2026-10-27T10:00:00',0,'standard','hourly',NULL,NULL,'pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9515,9504,5,NULL,1,0,'2026-10-27T11:00:00','2026-10-27T12:00:00',0,'standard','hourly',NULL,NULL,'pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9516,9505,4,NULL,1,0,'2026-10-28T09:00:00','2026-10-28T11:00:00',0,'standard','hourly',NULL,NULL,'pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9517,9506,4,NULL,1,0,'2026-10-29T09:00:00','2026-10-29T10:00:00',0,'standard','hourly',NULL,NULL,'pending',NULL);
INSERT INTO "booking_items" ("id","booking_id","room_id","service_id","quantity","price","start_time","end_time","subtotal","layout","booking_type","guest_count","pin_code","checkin_status","checkin_at") VALUES(9518,9507,4,NULL,1,500,'2026-10-30T09:00:00','2026-10-30T10:00:00',500,'standard','hourly',NULL,NULL,'pending',NULL);
CREATE TABLE slip_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  trans_ref TEXT,
  bank_code TEXT,
  bank_name TEXT,
  amount REAL,
  slip_image_url TEXT,
  is_auto_approved INTEGER DEFAULT 0,
  confidence_score REAL DEFAULT 0,
  raw_qr_data TEXT,
  ocr_text TEXT,
  verification_status TEXT DEFAULT 'pending',
  rejection_reason TEXT,
  created_at TEXT
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO "settings" ("key","value") VALUES('company_name','บริษัท บิลท์ ฮาร์ท จำกัด (Staging Environment)');
INSERT INTO "settings" ("key","value") VALUES('receipt_header','ใบเสร็จรับเงิน (STAGING / TEST ONLY)');
INSERT INTO "settings" ("key","value") VALUES('receipt_footer','เอกสารทดสอบระบบสเตจจิ้ง ไม่ใช่ใบเสร็จรับเงินจริง');
INSERT INTO "settings" ("key","value") VALUES('company_address','98 หมู่ 2 อาคารบีเวิร์ค (Staging Lab) จ.นนทบุรี 11120');
INSERT INTO "settings" ("key","value") VALUES('cleaning_buffer_minutes','15');
INSERT INTO "settings" ("key","value") VALUES('payment_deadline_hours','24');
INSERT INTO "settings" ("key","value") VALUES('room_alert_minutes','15');
INSERT INTO "settings" ("key","value") VALUES('wifi_ssid','@BWORK');
INSERT INTO "settings" ("key","value") VALUES('promptpay_id','0000000000000');
INSERT INTO "settings" ("key","value") VALUES('payment_bank_name','ธนาคารทดสอบสเตจจิ้ง (Mock Test Bank)');
INSERT INTO "settings" ("key","value") VALUES('payment_bank_account','000-0-00000-0');
INSERT INTO "settings" ("key","value") VALUES('payment_bank_account_name','บัญชีทดสอบระบบ สเตจจิ้ง');
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'staff',
  permissions TEXT,
  fullname TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "users" ("id","username","password_hash","role","permissions","fullname","created_at") VALUES(1,'admin_staging','8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918','admin','pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation','ผู้ดูแลระบบ (Staging Admin)','2026-10-13 05:03:33');
INSERT INTO "users" ("id","username","password_hash","role","permissions","fullname","created_at") VALUES(2,'staff_staging','8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918','staff','pos,pending,layout,manage','พนักงานบริการ (Staging Staff)','2026-10-12 17:53:10');
INSERT INTO "users" ("id","username","password_hash","role","permissions","fullname","created_at") VALUES(3,'admin','875ef3449d776b1bd23a4aaee7d47d0beebc4bd8ca084e4d7f2b6a5fa619dd4a','admin','pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation','ผู้ดูแลระบบ (Staging Admin)','2026-10-13 05:41:21');
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  permissions TEXT NOT NULL,
  is_system INTEGER DEFAULT 0
);
INSERT INTO "roles" ("id","name","label","permissions","is_system") VALUES(1,'admin','ผู้ดูแลระบบสเตจจิ้ง','pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation',1);
INSERT INTO "roles" ("id","name","label","permissions","is_system") VALUES(2,'staff','พนักงานบริการสเตจจิ้ง','pos,pending,layout,manage',1);
CREATE TABLE quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  department TEXT,
  contact TEXT,
  total_amount REAL NOT NULL,
  status TEXT DEFAULT 'draft',
  valid_until TEXT,
  seller_name TEXT,
  job_name TEXT,
  customer_address TEXT,
  quotation_no TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE quotation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER REFERENCES quotations(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id),
  service_id INTEGER REFERENCES services(id),
  quantity INTEGER DEFAULT 1,
  price REAL NOT NULL,
  start_time TEXT,
  end_time TEXT,
  subtotal REAL NOT NULL,
  layout TEXT DEFAULT 'standard',
  booking_type TEXT DEFAULT 'hourly',
  discount REAL DEFAULT 0,
  item_date TEXT,
  discount_type TEXT DEFAULT 'amount'
);
CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  tax_id TEXT,
  address TEXT,
  company TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3b82f6',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL,
  transaction_type TEXT DEFAULT 'full',
  slip_url TEXT,
  status TEXT DEFAULT 'completed',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "payment_transactions" ("id","booking_id","amount","payment_method","transaction_type","slip_url","status","created_at") VALUES(9201,9001,1000,'promptpay','full',NULL,'completed','2026-10-20 08:05:00');
INSERT INTO "payment_transactions" ("id","booking_id","amount","payment_method","transaction_type","slip_url","status","created_at") VALUES(9202,9002,1600,'promptpay','full',NULL,'completed','2026-10-21 08:10:00');
INSERT INTO "payment_transactions" ("id","booking_id","amount","payment_method","transaction_type","slip_url","status","created_at") VALUES(9203,9005,600,'cash','full',NULL,'completed','2026-10-13T07:45:14.128Z');
CREATE TABLE timeline_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE booking_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  performed_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE cash_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  opened_by TEXT NOT NULL,
  opening_cash REAL NOT NULL,
  opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME,
  closed_by TEXT,
  closing_cash REAL,
  expected_cash REAL,
  difference REAL,
  status TEXT DEFAULT 'open',
  notes TEXT
);
CREATE TABLE cash_drawer_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER,
  action TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT,
  performed_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE room_hour_credits (
  credit_id TEXT PRIMARY KEY,
  source_booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  source_item_id INTEGER NOT NULL REFERENCES booking_items(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  line_user_id TEXT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE room_hour_credit_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_id TEXT NOT NULL REFERENCES room_hour_credits(credit_id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('grant','redeem','reversal')),
  minutes_delta INTEGER NOT NULL CHECK(typeof(minutes_delta)='integer' AND minutes_delta != 0),
  booking_item_id INTEGER REFERENCES booking_items(id) ON DELETE RESTRICT,
  reverses_entry_id INTEGER UNIQUE REFERENCES room_hour_credit_entries(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK(length(trim(reason))>0),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  CHECK((entry_type='grant' AND minutes_delta>0 AND booking_item_id IS NULL AND reverses_entry_id IS NULL)
     OR (entry_type='redeem' AND minutes_delta<0 AND booking_item_id IS NOT NULL AND reverses_entry_id IS NULL)
     OR (entry_type='reversal' AND minutes_delta>0 AND booking_item_id IS NOT NULL AND reverses_entry_id IS NOT NULL))
);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('_schema_migrations',9);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('rooms',11);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('services',2);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('roles',2);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('users',3);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('bookings',9507);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('booking_items',9518);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('payment_transactions',9203);
CREATE INDEX idx_booking_items_booking_id ON booking_items(booking_id);
CREATE INDEX idx_booking_items_room_id ON booking_items(room_id);
CREATE INDEX idx_booking_items_room_time ON booking_items(room_id, start_time, end_time);
CREATE INDEX idx_bookings_created_at ON bookings(created_at DESC);
CREATE INDEX idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX idx_bookings_receipt_number ON bookings(receipt_number);
CREATE INDEX idx_bookings_pin_code ON bookings(pin_code);
CREATE INDEX idx_bookings_balance_amount ON bookings(balance_amount);
CREATE INDEX idx_payment_transactions_booking_id ON payment_transactions(booking_id);
CREATE INDEX idx_quotation_items_quotation_id ON quotation_items(quotation_id);
CREATE INDEX idx_quotations_created_at ON quotations(created_at DESC);
CREATE INDEX idx_quotations_status ON quotations(status);
CREATE INDEX room_hour_credit_phone ON room_hour_credits(customer_phone);
CREATE INDEX room_hour_credit_history ON room_hour_credit_entries(credit_id, id);
CREATE UNIQUE INDEX room_hour_credit_grant ON room_hour_credit_entries(credit_id) WHERE entry_type='grant';
CREATE UNIQUE INDEX room_hour_credit_redeem_item ON room_hour_credit_entries(booking_item_id) WHERE entry_type='redeem';
CREATE TRIGGER hour_credit_no_negative BEFORE INSERT ON room_hour_credit_entries
WHEN COALESCE((SELECT SUM(minutes_delta) FROM room_hour_credit_entries WHERE credit_id=NEW.credit_id),0)+NEW.minutes_delta<0
BEGIN SELECT RAISE(ABORT,'hour credit insufficient balance'); END;
CREATE TRIGGER hour_credit_valid_reversal BEFORE INSERT ON room_hour_credit_entries
WHEN NEW.entry_type='reversal' AND NOT EXISTS (
 SELECT 1 FROM room_hour_credit_entries e WHERE e.id=NEW.reverses_entry_id AND e.entry_type='redeem'
 AND e.credit_id=NEW.credit_id AND e.booking_item_id=NEW.booking_item_id AND e.minutes_delta=-NEW.minutes_delta)
BEGIN SELECT RAISE(ABORT,'invalid hour credit reversal'); END;
CREATE TRIGGER hour_credit_entries_no_update BEFORE UPDATE ON room_hour_credit_entries
BEGIN SELECT RAISE(ABORT,'hour credit ledger is append only'); END;
CREATE TRIGGER hour_credit_entries_no_delete BEFORE DELETE ON room_hour_credit_entries
BEGIN SELECT RAISE(ABORT,'hour credit ledger is append only'); END;
CREATE TRIGGER hour_credit_no_update BEFORE UPDATE ON room_hour_credits
BEGIN SELECT RAISE(ABORT,'hour credit identity is immutable'); END;
CREATE TRIGGER hour_credit_no_delete BEFORE DELETE ON room_hour_credits
BEGIN SELECT RAISE(ABORT,'hour credit history is permanent'); END;
CREATE TRIGGER hour_credit_booking_no_delete BEFORE DELETE ON bookings
WHEN EXISTS(SELECT 1 FROM room_hour_credits WHERE source_booking_id=OLD.id)
 OR EXISTS(SELECT 1 FROM room_hour_credit_entries e JOIN booking_items i ON i.id=e.booking_item_id WHERE i.booking_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'booking linked to hour credit cannot be deleted'); END;
CREATE TRIGGER hour_credit_item_no_delete BEFORE DELETE ON booking_items
WHEN EXISTS(SELECT 1 FROM room_hour_credits WHERE source_item_id=OLD.id)
 OR EXISTS(SELECT 1 FROM room_hour_credit_entries WHERE booking_item_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'item linked to hour credit cannot be deleted'); END;
