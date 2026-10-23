const fs = require('fs');
const path = require('path');

/**
 * Safely executes migration SQL statements.
 * For ALTER TABLE ... ADD COLUMN statements, checks PRAGMA table_info to avoid
 * duplicate column errors on fresh installs or canonical schemas.
 */
async function executeMigrationSql(dbQuery, sql) {
  const cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = cleaned.split('\n');
  const statements = [];
  let currentStmt = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) continue;
    currentStmt += line + '\n';
    if (trimmed.endsWith(';')) {
      const stmt = currentStmt.trim();
      if (stmt && stmt !== ';') {
        statements.push(stmt);
      }
      currentStmt = '';
    }
  }
  if (currentStmt.trim()) {
    statements.push(currentStmt.trim());
  }

  for (const stmt of statements) {
    const alterMatch = stmt.match(/ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?/i);
    if (alterMatch) {
      const tableName = alterMatch[1];
      const columnName = alterMatch[2];
      try {
        const cols = await dbQuery.all(`PRAGMA table_info(${tableName})`);
        if (cols && cols.some(c => c.name.toLowerCase() === columnName.toLowerCase())) {
          continue;
        }
      } catch (checkErr) {}
    }

    try {
      await dbQuery.exec(stmt);
    } catch (stmtErr) {
      if (stmtErr.message && stmtErr.message.toLowerCase().includes('duplicate column name')) {
        continue;
      }
      throw stmtErr;
    }
  }
}

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
      await executeMigrationSql(dbQuery, sql);

      // Record migration
      await dbQuery.run('INSERT INTO _schema_migrations (version) VALUES (?)', [file]);
      console.log('[Migrator] Successfully applied migration: ' + file);
    }
  } catch (err) {
    console.error('[Migrator] Error running migrations:', err.message);
    throw err;
  }
}

module.exports = { runMigrations, executeMigrationSql };
