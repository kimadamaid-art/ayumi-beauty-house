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
    const users = [
        { id: '98b2d220-fa70-4df1-93b6-b9d2d75b36e9', email: 'kimadamaid@gmail.com', role: 'owner' },
        { id: 'e8bb0ec9-4da5-4b4b-a7fd-e65021c12216', email: 'lilissetiawatii.1211@gmail.com', role: 'admin' }
    ];

    console.log('Resetting passwords...');
    for (const u of users) {
        const { data, error } = await supabase.auth.admin.updateUserById(u.id, {
            password: 'Password123!'
        });
        if (error) {
            console.error(`Failed to update password for ${u.email}:`, error.message);
        } else {
            console.log(`Successfully reset password for ${u.email} (${u.role}) to: Password123!`);
        }
    }
}

run();
