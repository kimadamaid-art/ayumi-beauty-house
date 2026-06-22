const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
envText.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/(^"|"$)/g, '').replace(/\r/g, '');
    }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    console.log('--- THERAPIST PAST APPOINTMENTS BY BRANCH ---');
    const { data: apts, error } = await supabase
        .from('appointments')
        .select('therapist_id, branch_id, status, users!appointments_therapist_id_fkey(full_name), branches(name)');
    
    if (error) {
        console.error(error);
    } else {
        const counts = {};
        apts.forEach(a => {
            if (a.therapist_id) {
                const key = `${a.users?.full_name} (${a.therapist_id}) -> Branch: ${a.branches?.name} (${a.branch_id})`;
                counts[key] = (counts[key] || 0) + 1;
            }
        });
        console.log(counts);
    }
}

check();
