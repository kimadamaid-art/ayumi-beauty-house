const fs = require('fs');
const https = require('https');

// Load env variables
const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
envText.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/(^"|"$)/g, '').replace(/\r/g, '');
    }
});

console.log('Parsed URL:', env.NEXT_PUBLIC_SUPABASE_URL);

const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`;
const options = {
    headers: {
        'apikey': env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
    }
};

https.get(url, options, (res) => {
    let data = '';
    console.log('Status Code:', res.statusCode);
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const schema = JSON.parse(data);
            console.log('Tables:', Object.keys(schema.definitions || {}));
            console.log('Paths:', Object.keys(schema.paths || {}));
        } catch (e) {
            console.error('Error parsing response:', e);
            console.log('Raw data length:', data.length);
        }
    });
}).on('error', (err) => {
    console.error('Error fetching schema:', err);
});
