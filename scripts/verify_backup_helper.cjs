const path = require('path');
const fs = require('fs');

const [backupFile, tempDbPath, releaseDir] = process.argv.slice(2);

if (!backupFile || !tempDbPath || !releaseDir) {
    console.error('Usage: node verify_backup_helper.cjs <backupFile> <tempDbPath> <releaseDir>');
    process.exit(1);
}

const sqlite3Path = path.join(releaseDir, 'backend', 'node_modules', 'sqlite3');
const sqlite3 = require(sqlite3Path).verbose();

if (fs.existsSync(tempDbPath)) {
    try { fs.unlinkSync(tempDbPath); } catch (_) {}
}

const db = new sqlite3.Database(tempDbPath);
const sql = fs.readFileSync(backupFile, 'utf8');

db.exec(sql, (err) => {
    if (err) {
        console.error('SQL Execution Error during test import:', err.message);
        process.exit(1);
    }

    db.all('PRAGMA integrity_check;', (err2, rows) => {
        if (err2 || !rows || rows[0].integrity_check !== 'ok') {
            console.error('PRAGMA integrity_check failed:', err2 || rows);
            process.exit(1);
        }

        db.get('SELECT COUNT(*) as cnt FROM bookings;', (err3, row) => {
            if (err3 || !row || row.cnt === 0) {
                console.error('Bookings table row count check failed:', err3 || 'zero rows');
                process.exit(1);
            }

            console.log('Integrity check PASSED. Bookings count in dump:', row.cnt);
            db.close((closeErr) => {
                if (closeErr) {
                    console.error('Database close error:', closeErr);
                    process.exit(1);
                }
                process.exit(0);
            });
        });
    });
});
