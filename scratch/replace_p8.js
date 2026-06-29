const fs = require('fs');
const path = require('path');

function processDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            processDir(fullPath);
        } else if (fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let original = content;
            
            // Regex to replace p-8 with p-5 md:p-8
            // We match class names like "p-8", " p-8", "p-8 "
            content = content.replace(/(['"\s])p-8([\s'"])/g, '$1p-5 md:p-8$2');
            
            if (content !== original) {
                fs.writeFileSync(fullPath, content);
                console.log('Updated p-8 in', fullPath);
            }
        }
    }
}

processDir('./app');
