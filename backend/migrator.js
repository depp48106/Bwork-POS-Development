const fs = require('fs');
const path = require('path');

/**
 * Versioned Migration Runner for SQLite
 * Automatically applies pending migrations in sequential order.
 */
async function runMigrations(dbQuery) {
  try {
    // 1. Ensure migrations table exists
    await dbQuery.exec(
      'CREATE TABLE IF NOT EXISTS _schema_migrations (' +
      '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
      '  version TEXT UNIQUE NOT NULL,' +
      '  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP' +
      ');'
    );

    // 2. Read migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // 3. Get applied migrations
    const appliedRows = await dbQuery.all('SELECT version FROM _schema_migrations');
    const appliedSet = new Set(appliedRows.map(r => r.version));

    // 4. Apply pending migrations sequentially
    for (const file of files) {
      if (appliedSet.has(file)) {
        continue;
      }

      console.log('[Migrator] Applying migration: ' + file + '...');
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Execute migration
      await dbQuery.exec(sql);

      // Record migration
      await dbQuery.run('INSERT INTO _schema_migrations (version) VALUES (?)', [file]);
      console.log('[Migrator] Successfully applied migration: ' + file);
    }
  } catch (err) {
    console.error('[Migrator] Error running migrations:', err.message);
    throw err;
  }
}

module.exports = { runMigrations };
