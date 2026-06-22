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

const mapping = {
    'asti@ayumi.com': '6bc44a26-f7f3-4ea7-8902-a2c48e27b598',       // Ciamis
    'rana@ayumi.com': '6bc44a26-f7f3-4ea7-8902-a2c48e27b598',       // Ciamis
    'elsa@ayumi.com': '6bc44a26-f7f3-4ea7-8902-a2c48e27b598',       // Ciamis
    'raika@ayumi.com': '964eaa28-e905-430a-b3da-38e48dcbb813',      // Tasikmalaya
    'fransiska@ayumi.com': '964eaa28-e905-430a-b3da-38e48dcbb813',  // Tasikmalaya
    'indri@ayumi.com': 'c4f02158-921a-4f8b-a4bc-5a98394dc35e',      // Banjar
    'annisa@ayumi.com': 'c4f02158-921a-4f8b-a4bc-5a98394dc35e'      // Banjar
};

async function run() {
    console.log('Updating therapist branch assignments...');
    for (const [email, branchId] of Object.entries(mapping)) {
        const { data, error } = await supabase
            .from('users')
            .update({ branch_id: branchId })
            .eq('email', email)
            .select();
        
        if (error) {
            console.error(`Failed to update ${email}:`, error.message);
        } else {
            console.log(`Successfully updated ${email} to branch ${branchId}`);
        }
    }
}

run();
