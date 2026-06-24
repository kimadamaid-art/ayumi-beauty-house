const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load env variables from .env.local
const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
envText.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/(^"|"$)/g, '').replace(/\r/g, '');
    }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
    console.log('Testing exec_sql RPC using ANON KEY...');
    const { data, error } = await supabase.rpc('exec_sql', { sql: 'SELECT 1 AS test_val;' });
    if (error) {
        console.error('FAILED to call exec_sql with Anon Key:', error.message);
    } else {
        console.log('SUCCESS! exec_sql is callable with Anon Key. Result:', data);
    }
}

check();
