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
    const therapistId = '75096a94-b151-4d97-8301-56b173dbc7dc'; // therapist id
    const { data, error } = await supabase.auth.admin.updateUserById(therapistId, {
        password: 'Password123!'
    });
    if (error) {
        console.error('Failed to update therapist password:', error.message);
    } else {
        console.log('Successfully reset therapist password to: Password123!');
    }
}

run();
