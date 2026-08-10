const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // Fix \` to `
  content = content.replace(/\\`/g, '`');
  // Fix \$ to $
  content = content.replace(/\\\$/g, '$');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Cleaned backslashes in:', filePath);
  }
}

function scan(dir) {
  const files = fs.readdirSync(dir);
  for (let file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      scan(fullPath);
    } else if (file.endsWith('.jsx') || file.endsWith('.js')) {
      fixFile(fullPath);
    }
  }
}

scan(srcDir);
console.log('Cleaned All Backslashes!');
