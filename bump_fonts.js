const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      walkDir(dirPath, callback);
    } else if (dirPath.endsWith('.jsx')) {
      callback(dirPath);
    }
  });
}

const SKIP_FILES = [
  'TopBar.jsx' // skip toolbar buttons as requested
];

const BUMP_AMOUNT = 2; // increasing by 2px

walkDir('src', function(filePath) {
  if (SKIP_FILES.some(skip => filePath.endsWith(skip))) {
    console.log(`Skipping ${filePath}`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  let newContent = content.replace(/fontSize:\s*(\d+)/g, (match, p1) => {
    let size = parseInt(p1, 10);
    
    // "el nombre del aeropeurto se ve bien" -> IATA is 20 in DrawerAeropuerto.
    // Also, anything larger than 18 is already a title, maybe we shouldn't bump it too much.
    // But specifically, if it's 20, we can leave it. Let's just not bump sizes >= 20.
    if (size >= 20) {
      return match;
    }
    
    // We bump all other font sizes by 2
    return `fontSize: ${size + BUMP_AMOUNT}`;
  });
  
  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`Updated ${filePath}`);
  }
});

console.log("Done bumping fonts!");
