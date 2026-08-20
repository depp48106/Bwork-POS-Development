const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');

db.run("INSERT INTO bookings (customer_name, total_amount, payment_status, created_at, receipt_number) VALUES ('TestDeleteUser', 100, 'paid', '2026-08-13 10:00:00', 'REC-TEST-DELETE-001')", async function(err) {
  if (err) return console.error('Insert error:', err);
  const newId = this.lastID;
  console.log('Created dummy booking ID:', newId);

  try {
    const res = await fetch('http://localhost:5000/api/bookings/' + newId, { method: 'DELETE' });
    const data = await res.json();
    console.log('DELETE API Response:', res.status, data);

    db.get('SELECT * FROM bookings WHERE id = ?', [newId], (e, row) => {
      console.log('Row in DB after delete:', row ? 'STILL EXISTS' : 'DELETED SUCCESS');
      db.close();
    });
  } catch (fetchErr) {
    console.error('Fetch error:', fetchErr);
  }
});
