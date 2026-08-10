SELECT 'rooms' AS table_name, COUNT(*) AS count FROM rooms
UNION ALL
SELECT 'services', COUNT(*) FROM services
UNION ALL
SELECT 'bookings', COUNT(*) FROM bookings
UNION ALL
SELECT 'booking_items', COUNT(*) FROM booking_items
UNION ALL
SELECT 'settings', COUNT(*) FROM settings
UNION ALL
SELECT 'users', COUNT(*) FROM users
UNION ALL
SELECT 'roles', COUNT(*) FROM roles;
