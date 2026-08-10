const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // Replace fetch('/api/...'), fetch("/api/..."), fetch(`/api/...`)
  content = content.replace(/fetch\((['"`])\/api\//g, (match, quote) => {
    if (quote === '`') {
      return 'fetch(`${API_BASE}/api/';
    }
    return `fetch(\`\${API_BASE}/api/`;
  });

  // Ensure end quotes for template literals
  content = content.replace(/fetch\(\`\${API_BASE}\/api\/([^'"`]+)(['"])\)/g, (match, pathInside, endQuote) => {
    return `fetch(\`\${API_BASE}/api/${pathInside}\`)`;
  });

  if (content !== original) {
    // Add import statement if missing
    if (!content.includes('import { API_BASE }')) {
      const isSubDir = filePath.includes(path.join('src', 'components'));
      const importPath = isSubDir ? '../apiConfig' : './apiConfig';
      content = `import { API_BASE } from '${importPath}';\n` + content;
    }
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated:', filePath);
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
console.log('API URL Replacement Complete!');
