const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load env variables
const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
envText.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/(^"|"$)/g, '').replace(/\r/g, '');
    }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    // Test inserting duration
    const { error: err1 } = await supabase.from('treatments').insert([{
        name: 'Test Duration Column',
        price: 1000,
        duration: 45
    }]);
    console.log('Insert with "duration":', err1 ? err1.message : 'SUCCESS');

    // Test inserting duration_minutes
    const { error: err2 } = await supabase.from('treatments').insert([{
        name: 'Test Duration Minutes Column',
        price: 1000,
        duration_minutes: 45
    }]);
    console.log('Insert with "duration_minutes":', err2 ? err2.message : 'SUCCESS');
}

check();
