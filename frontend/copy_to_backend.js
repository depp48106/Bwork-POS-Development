const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'dist');
const dest = path.join(__dirname, '../backend/public');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

try {
  copyRecursiveSync(src, dest);
  console.log('Successfully copied build output from frontend/dist to backend/public!');
} catch (err) {
  console.error('Error copying build output:', err);
}
