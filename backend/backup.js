const path = require('path');
const fs = require('fs');
const { dbQuery } = require('./database');

async function backupDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const appEnv = process.env.APP_ENV || 'development';
  const backupFile = path.join(backupDir, 'bwork_' + appEnv + '_backup_' + timestamp + '.sqlite');

  console.log('[Backup] Starting live database backup to: ' + backupFile + '...');
  // SQLite VACUUM INTO creates a consistent point-in-time copy while database is live and running
  const escapedPath = backupFile.replace(/\\/g, '/');
  await dbQuery.exec("VACUUM INTO '" + escapedPath + "';");
  console.log('[Backup] Live backup completed successfully: ' + backupFile);
  return backupFile;
}

if (require.main === module) {
  backupDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Backup] Backup failed:', err.message);
      process.exit(1);
    });
}

module.exports = { backupDatabase };
