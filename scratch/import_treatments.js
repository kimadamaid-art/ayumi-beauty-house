const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const XLSX = require('xlsx');

// 1. Load env variables
const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
envText.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/(^"|"$)/g, '').replace(/\r/g, '');
    }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function parseExcelPrice(priceStr) {
    if (!priceStr) return 0;
    if (typeof priceStr === 'number') return priceStr;
    
    let cleanStr = priceStr.toString();
    if (cleanStr.includes('-')) {
        cleanStr = cleanStr.split('-')[0].trim();
    }
    
    cleanStr = cleanStr.replace(/\./g, '').replace(/,/g, '.');
    const parsed = parseFloat(cleanStr);
    return isNaN(parsed) ? 0 : parsed;
}

async function run() {
    try {
        console.log('Starting data cleanup...');
        
        // Clean dependent tables to prevent foreign key errors
        console.log('Cleaning followup_queue...');
        await supabase.from('followup_queue').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        
        console.log('Cleaning treatment_record_items...');
        await supabase.from('treatment_record_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        
        console.log('Cleaning treatment_records...');
        await supabase.from('treatment_records').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        
        console.log('Cleaning appointment_treatments...');
        await supabase.from('appointment_treatments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        
        console.log('Cleaning appointments...');
        await supabase.from('appointments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        
        console.log('Cleaning treatments...');
        await supabase.from('treatments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        
        console.log('Cleanup finished successfully.');

        // Load Excel File
        console.log('Reading Excel file...');
        const workbook = XLSX.readFile('Harga Item Ayumi (1).xlsx');
        const sheetName = 'Sheet1';
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet);
        
        console.log(`Found ${rows.length} rows to import.`);

        const insertPayload = rows.map(row => {
            const rawPrice = row['Item Price'];
            const parsedPrice = parseExcelPrice(rawPrice);
            return {
                name: row['Item Name'],
                price: parsedPrice,
                duration_minutes: 60,
                followup_days: 30,
                is_active: true,
                category_id: null
            };
        });

        // Insert in chunks of 50 to avoid any Supabase request limits
        const chunkSize = 50;
        for (let i = 0; i < insertPayload.length; i += chunkSize) {
            const chunk = insertPayload.slice(i, i + chunkSize);
            console.log(`Inserting chunk ${i / chunkSize + 1} (${chunk.length} items)...`);
            const { error } = await supabase.from('treatments').insert(chunk);
            if (error) {
                throw error;
            }
        }
        
        console.log('Import completed successfully!');
    } catch (err) {
        console.error('Error occurred during cleanup or import:', err);
    }
}

run();
