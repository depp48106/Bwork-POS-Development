const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // Clean fetch template strings
  content = content.replace(/fetch\((['"`])\$\{API_BASE\}\/api\//g, 'fetch(`${API_BASE}/api/');
  content = content.replace(/fetch\(\`\`\$\{API_BASE\}/g, 'fetch(`${API_BASE}');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed:', filePath);
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
