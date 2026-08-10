const fs = require('fs');
const path = require('path');

function fix(dir) {
  fs.readdirSync(dir).forEach(file => {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      fix(full);
    } else if (file.endsWith('.jsx') || file.endsWith('.js')) {
      let c = fs.readFileSync(full, 'utf8');
      if (c.includes('fetch(\\`')) {
        c = c.split('fetch(\\`').join('fetch(`');
        fs.writeFileSync(full, c, 'utf8');
        console.log('Fixed:', full);
      }
    }
  });
}

fix(path.join(__dirname, 'src'));
console.log('Done fixing fetch backslashes!');
