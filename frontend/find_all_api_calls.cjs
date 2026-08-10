const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const apiEndpoints = new Set();

function scan(dir) {
  fs.readdirSync(dir).forEach(file => {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) scan(full);
    else if (file.endsWith('.jsx') || file.endsWith('.js')) {
      const content = fs.readFileSync(full, 'utf8');
      const matches = content.match(/fetch\s*\(\s*[`'"]([^`'"]+)[`'"]/g) || [];
      matches.forEach(m => apiEndpoints.add(m));
      const templateMatches = content.match(/fetch\s*\(\s*`([^`]+)`/g) || [];
      templateMatches.forEach(m => apiEndpoints.add(m));
    }
  });
}

scan(srcDir);
console.log('All API endpoints called in frontend:');
apiEndpoints.forEach(ep => console.log(ep));
