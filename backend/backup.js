const fs = require('fs');
const path = require('path');
const { dbQuery } = require('./database');

async function performBackup() {
  try {
    // 1. Get the OneDrive backup path from database settings
    const setting = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_path'");
    let backupDir = setting ? setting.value : '';

    if (!backupDir) {
      throw new Error('ยังไม่ได้กำหนดที่อยู่โฟลเดอร์สำหรับสำรองข้อมูล OneDrive');
    }

    // Resolve any environment variables (like %USERPROFILE%)
    if (backupDir.includes('%USERPROFILE%')) {
      backupDir = backupDir.replace('%USERPROFILE%', process.env.USERPROFILE || 'C:\\');
    }

    // 2. Ensure target directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // 3. Define source and destination paths
    const dbSourcePath = path.join(__dirname, 'database.sqlite');
    
    // Create filename with timestamp
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const sec = String(now.getSeconds()).padStart(2, '0');
    
    const timestamp = `${year}${month}${day}_${hour}${min}${sec}`;
    const dbDestPath = path.join(backupDir, `database_backup_${timestamp}.sqlite`);

    // 4. Perform the file copy
    if (!fs.existsSync(dbSourcePath)) {
      throw new Error('ไม่พบไฟล์ฐานข้อมูลหลักสำหรับการสำรองข้อมูล');
    }

    // Copy file
    fs.copyFileSync(dbSourcePath, dbDestPath);

    console.log(`Database backed up successfully to: ${dbDestPath}`);
    return {
      success: true,
      message: 'สำรองข้อมูลสำเร็จ',
      fileName: `database_backup_${timestamp}.sqlite`,
      path: dbDestPath,
      timestamp: now.toISOString()
    };
  } catch (error) {
    console.error('Backup failed:', error);
    return {
      success: false,
      message: `การสำรองข้อมูลล้มเหลว: ${error.message}`
    };
  }
}

module.exports = {
  performBackup
};
