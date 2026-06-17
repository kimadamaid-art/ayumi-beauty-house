const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 1. Load env variables
const envPath = path.join(__dirname, '..', '.env.local');
if (!fs.existsSync(envPath)) {
    console.error('File .env.local tidak ditemukan di:', envPath);
    process.exit(1);
}

const envText = fs.readFileSync(envPath, 'utf8');
const env = {};
envText.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/(^"|"$)/g, '').replace(/\r/g, '');
    }
});

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di .env.local');
    process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log('Background worker pengingat aktif...');

// Helper timezone GMT+7
const getGMT7Time = () => {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 7));
};

const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const formatTime = (date) => {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
};

async function checkReminders() {
    try {
        const gmt7Now = getGMT7Time();
        const todayStr = formatDate(gmt7Now);
        console.log(`[${new Date().toISOString()}] Menjalankan pengecekan untuk tanggal: ${todayStr} (GMT+7: ${formatTime(gmt7Now)})`);

        // Fetch semua appointments hari ini yang aktif
        const { data: appointments, error: aptError } = await supabase
            .from('appointments')
            .select(`
                id,
                appointment_date,
                start_time,
                status,
                arrival_status,
                arrived_at,
                therapist_ready_at,
                therapist_id,
                patients (full_name),
                therapist:users!appointments_therapist_id_fkey (id, full_name)
            `)
            .eq('appointment_date', todayStr)
            .in('status', ['scheduled', 'confirmed']);

        if (aptError) {
            console.error('Error mengambil appointments:', aptError.message);
            return;
        }

        if (!appointments || appointments.length === 0) {
            console.log('Tidak ada janji temu hari ini untuk dicek.');
            return;
        }

        for (const appt of appointments) {
            // Skip jika tidak ada terapis yang ditugaskan
            if (!appt.therapist_id) continue;

            const therapistName = appt.therapist?.full_name || 'Terapis';
            const patientName = appt.patients?.full_name || 'Pasien';

            // --- 1. PENGINGAT 15 MENIT SEBELUM JANJI TEMU ---
            if (appt.arrival_status === 'not_arrived' || !appt.arrival_status) {
                const [startH, startM, startS] = appt.start_time.split(':').map(Number);
                const apptTime = new Date(gmt7Now);
                apptTime.setHours(startH, startM, startS || 0, 0);

                const diffMins = (apptTime - gmt7Now) / 1000 / 60;

                // Jika janji temu mulai dalam 15 menit ke depan (0 sampai 15 menit)
                if (diffMins > 0 && diffMins <= 15) {
                    const title = 'Pengingat Janji Temu';
                    
                    // Cek apakah sudah pernah dikirim
                    const { data: existing, error: errExist } = await supabase
                        .from('notifications')
                        .select('id')
                        .eq('appointment_id', appt.id)
                        .eq('title', title)
                        .limit(1);

                    if (!errExist && (!existing || existing.length === 0)) {
                        const message = `Halo ${therapistName}, Anda memiliki janji temu dengan ${patientName} dalam 15 menit lagi (pukul ${appt.start_time.substring(0, 5)} WIB). Mohon bersiap.`;
                        
                        console.log(`Mengirim pengingat 15 menit ke ${therapistName} untuk janji temu ${appt.id}`);
                        
                        const { error: insErr } = await supabase
                            .from('notifications')
                            .insert([{
                                recipient_id: appt.therapist_id,
                                appointment_id: appt.id,
                                type: 'general',
                                title: title,
                                message: message
                            }]);

                        if (insErr) {
                            console.error('Gagal memasukkan notifikasi:', insErr.message);
                        }
                    }
                }
            }

            // --- 2. PERINGATAN PASIEN MENUNGGU > 10 MENIT ---
            if (appt.arrival_status === 'arrived' && appt.arrived_at && !appt.therapist_ready_at) {
                const arrivedTime = new Date(appt.arrived_at);
                const currentRealTime = new Date();
                const waitMins = (currentRealTime - arrivedTime) / 1000 / 60;

                if (waitMins >= 10) {
                    const title = 'Peringatan: Pasien Menunggu';

                    // Cek apakah sudah pernah dikirim
                    const { data: existing, error: errExist } = await supabase
                        .from('notifications')
                        .select('id')
                        .eq('appointment_id', appt.id)
                        .eq('title', title)
                        .limit(1);

                    if (!errExist && (!existing || existing.length === 0)) {
                        const message = `Pasien ${patientName} telah menunggu selama lebih dari 10 menit sejak kedatangan. Mohon segera bersiap dan konfirmasi di dashboard Anda.`;
                        
                        console.log(`Mengirim peringatan pasien menunggu ke ${therapistName} untuk janji temu ${appt.id}`);

                        const { error: insErr } = await supabase
                            .from('notifications')
                            .insert([{
                                recipient_id: appt.therapist_id,
                                appointment_id: appt.id,
                                type: 'general',
                                title: title,
                                message: message
                            }]);

                        if (insErr) {
                            console.error('Gagal memasukkan notifikasi:', insErr.message);
                        }
                    }
                }
            }
        }

    } catch (e) {
        console.error('Kesalahan fatal pada checkReminders:', e);
    }
}

// Jalankan pertama kali langsung
checkReminders();

// Jalankan berkala setiap 30 detik
const interval = setInterval(checkReminders, 30000);

// Graceful shutdown
process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('Background worker dinonaktifkan.');
    process.exit(0);
});
