const path = require('path');
const fs = require('fs');

const [backupFile, tempDbPath, releaseDir] = process.argv.slice(2);

if (!backupFile || !tempDbPath || !releaseDir) {
    console.error('Usage: node verify_backup_helper.cjs <backupFile> <tempDbPath> <releaseDir>');
    process.exit(1);
}

if (!fs.existsSync(backupFile)) {
    console.error('Backup file does not exist:', backupFile);
    process.exit(1);
}

const sqlite3Path = path.join(releaseDir, 'backend', 'node_modules', 'sqlite3');
if (!fs.existsSync(sqlite3Path)) {
    console.error('sqlite3 module not found at:', sqlite3Path);
    process.exit(1);
}
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
        if (err2 || !rows || rows.length === 0 || rows[0].integrity_check !== 'ok') {
            console.error('PRAGMA integrity_check failed:', err2 || rows);
            process.exit(1);
        }

        // Verify core tables existence
        const coreTables = ['bookings', 'payment_transactions', 'customers', 'users', 'rooms', 'settings'];
        db.all("SELECT name FROM sqlite_master WHERE type='table';", (errTable, tableRows) => {
            if (errTable) {
                console.error('Failed to query tables:', errTable.message);
                process.exit(1);
            }
            const existingTables = new Set((tableRows || []).map(r => r.name));
            const missingTables = coreTables.filter(t => !existingTables.has(t));
            if (missingTables.length > 0) {
                console.error('Missing core tables in backup dump:', missingTables.join(', '));
                process.exit(1);
            }

            db.get('SELECT COUNT(*) as cnt FROM bookings;', (err3, row) => {
                if (err3 || !row || row.cnt === 0) {
                    console.error('Bookings table row count check failed:', err3 || 'zero rows');
                    process.exit(1);
                }

                console.log(`[BACKUP-VERIFY-OK] Integrity: ok, Total Tables: ${tableRows.length}, Bookings: ${row.cnt}`);
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
});
