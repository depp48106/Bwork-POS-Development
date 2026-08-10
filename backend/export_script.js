const path = require('path');
const sqlite3 = require('./node_modules/sqlite3').verbose();
const fs = require('fs');

const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  db.all('SELECT * FROM rooms', (err, rooms) => {
    if (err) {
      console.error('Error fetching rooms:', err);
      return;
    }
    console.log(`Found ${rooms.length} rooms in local database.sqlite`);

    let sql = '-- Exported Rooms Data\nDELETE FROM rooms;\n';

    rooms.forEach(r => {
      const name = r.name ? `'${r.name.replace(/'/g, "''")}'` : 'NULL';
      const description = r.description ? `'${r.description.replace(/'/g, "''")}'` : 'NULL';
      const status = r.status ? `'${r.status.replace(/'/g, "''")}'` : "'active'";
      const image_url = r.image_url ? `'${r.image_url.replace(/'/g, "''")}'` : 'NULL';
      const classroom_image_url = r.classroom_image_url ? `'${r.classroom_image_url.replace(/'/g, "''")}'` : 'NULL';
      const category = r.category ? `'${r.category.replace(/'/g, "''")}'` : "'Meeting Room'";
      const pin_code = r.pin_code ? `'${r.pin_code.replace(/'/g, "''")}'` : 'NULL';

      sql += `INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, half_day_rate, has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url, description, status, image_url, category, pin_code) VALUES (${r.id}, ${name}, ${r.capacity || 0}, ${r.hourly_rate || 0}, ${r.daily_rate || 0}, ${r.half_day_rate || 0}, ${r.has_classroom || 0}, ${r.classroom_hourly_rate || 0}, ${r.classroom_daily_rate || 0}, ${r.classroom_capacity || 0}, ${classroom_image_url}, ${description}, ${status}, ${image_url}, ${category}, ${pin_code});\n`;
    });

    fs.writeFileSync('./import_rooms.sql', sql, 'utf8');
    console.log('Successfully generated import_rooms.sql!');
    db.close();
  });
});
