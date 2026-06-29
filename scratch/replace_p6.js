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
            
            // Regex to replace p-6 with p-4 md:p-6
            content = content.replace(/(['"\s])p-6([\s'"])/g, '$1p-4 md:p-6$2');
            
            if (content !== original) {
                fs.writeFileSync(fullPath, content);
                console.log('Updated p-6 in', fullPath);
            }
        }
    }
}

processDir('./app');
