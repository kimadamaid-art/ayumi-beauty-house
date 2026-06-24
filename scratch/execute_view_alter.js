const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

// Load environment variables from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const env = {};
if (fs.existsSync(envPath)) {
    const envText = fs.readFileSync(envPath, 'utf8');
    envText.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/(^"|"$)/g, '').replace(/\r/g, '');
        }
    });
}

const sqlFile = path.join(__dirname, 'alter_views_security_invoker.sql');
const sqlContent = fs.readFileSync(sqlFile, 'utf8');

async function run() {
    console.log('--- EXECUTING ALTER VIEW SECURITY_INVOKER ---');

    // 1. Try using Postgres Connection String if present
    const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL || process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL;
    if (dbUrl) {
        console.log('Found Database URL, connecting directly via pg client...');
        const client = new Client({
            connectionString: dbUrl,
            ssl: { rejectUnauthorized: false }
        });
        try {
            await client.connect();
            console.log('Connected! Executing SQL script...');
            await client.query(sqlContent);
            console.log('SUCCESS: Views altered to security_invoker successfully via Direct Postgres Connection!');
            await client.end();
            process.exit(0);
        } catch (err) {
            console.error('Direct connection execution failed:', err.message);
        }
    }

    // 2. Try using Supabase Service Role Key via exec_sql RPC
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;

    if (supabaseUrl && serviceRoleKey) {
        console.log('Found Supabase URL and Service Role Key, attempting exec_sql RPC...');
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        try {
            const { data, error } = await supabase.rpc('exec_sql', { sql: sqlContent });
            if (error) {
                console.error('RPC execution failed:', error.message);
            } else {
                console.log('SUCCESS: Views altered to security_invoker successfully via Supabase exec_sql RPC! Result:', data);
                process.exit(0);
            }
        } catch (err) {
            console.error('RPC execution failed:', err.message);
        }
    }

    // If both failed or are missing
    console.error('\n[ERROR] Gagal mengeksekusi SQL secara otomatis ke database remote.');
    console.log('Alasan: Kunci otentikasi admin (SUPABASE_SERVICE_ROLE_KEY atau DATABASE_URL) tidak ditemukan di .env.local atau environment variable.');
    process.exit(1);
}

run();
