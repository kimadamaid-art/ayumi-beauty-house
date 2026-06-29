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
            let modified = false;
            
            // Regex to add whitespace-nowrap to <table className="...">
            content = content.replace(/<table\s+className=(["'`])([^"']*)["'`]/g, (match, quote, classes) => {
                if (!classes.includes('whitespace-nowrap')) {
                    modified = true;
                    return `<table className=${quote}whitespace-nowrap ${classes}${quote}`;
                }
                return match;
            });
            
            if (modified) {
                fs.writeFileSync(fullPath, content);
                console.log('Updated', fullPath);
            }
        }
    }
}

processDir('./app');
