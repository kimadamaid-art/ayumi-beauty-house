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

async function run() {
    const { data: users, error } = await supabase.from('users').select('*');
    if (error) {
        console.error('Error fetching users:', error);
        return;
    }
    console.log('--- USERS LIST ---');
    users.forEach(u => {
        console.log(`ID: ${u.id} | Name: ${u.full_name} | Email: ${u.email} | Role: ${u.role}`);
    });
}

run();
