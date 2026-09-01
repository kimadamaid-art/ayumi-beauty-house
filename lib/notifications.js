/**
 * Helper terpadu untuk pengiriman notifikasi realtime antar-staf di Ayumi Beauty House
 */

/**
 * Kirim notifikasi ke Terapis saat Pasien Datang (Check-in di Front Desk / Kasir)
 */
export async function notifyPatientArrived({ supabase, appointment, senderId }) {
    if (!supabase || !appointment) return false

    try {
        const patientName = appointment.patients?.full_name || 'Pasien'
        const branchId = appointment.branch_id
        const therapistId = appointment.therapist_id

        // Ambil nama treatment jika ada
        let treatmentNames = 'Treatment'
        if (appointment.appointment_treatments && appointment.appointment_treatments.length > 0) {
            treatmentNames = appointment.appointment_treatments
                .map(at => at.treatments?.name || '')
                .filter(Boolean)
                .join(', ') || 'Treatment'
        }

        const timeStr = appointment.start_time ? appointment.start_time.substring(0, 5) : ''
        const notifTitle = 'Pasien Sudah Datang 🙋‍♀️'
        const notifMessage = `Pasien ${patientName} telah tiba di klinik untuk ${treatmentNames}${timeStr ? ` (jadwal ${timeStr})` : ''}. Silakan persiapkan ruangan & perawatan.`

        const recipientIds = []

        if (therapistId) {
            recipientIds.push(therapistId)
        } else if (branchId) {
            // Jika belum ada terapis spesifik, kirim ke seluruh terapis aktif di cabang tersebut
            const { data: branchTherapists } = await supabase
                .from('users')
                .select('id')
                .eq('role', 'therapist')
                .eq('branch_id', branchId)
                .eq('is_active', true)

            if (branchTherapists && branchTherapists.length > 0) {
                branchTherapists.forEach(t => recipientIds.push(t.id))
            }
        }

        if (recipientIds.length === 0) return false

        const payloads = recipientIds.map(rid => ({
            recipient_id: rid,
            sender_id: senderId || null,
            appointment_id: appointment.id || null,
            type: 'patient_arrived',
            title: notifTitle,
            message: notifMessage
        }))

        const { error } = await supabase.from('notifications').insert(payloads)
        if (error) {
            console.error('Error sending patient_arrived notification:', error.message)
            return false
        }
        return true
    } catch (err) {
        console.error('Failed to notify patient arrived:', err)
        return false
    }
}

/**
 * Kirim notifikasi ke Admin & Owner saat Terapis Siap Menerima Pasien
 */
export async function notifyTherapistReady({ supabase, appointment, therapistUser }) {
    if (!supabase || !appointment) return false

    try {
        const patientName = appointment.patients?.full_name || 'Pasien'
        const therapistName = therapistUser?.full_name || 'Terapis'
        const branchId = appointment.branch_id

        // Ambil semua admin di cabang terkait + seluruh owner
        const { data: staffUsers, error: uErr } = await supabase
            .from('users')
            .select('id, role, branch_id')
            .in('role', ['admin', 'owner', 'kasir', 'receptionist'])
            .eq('is_active', true)

        if (uErr || !staffUsers) {
            console.error('Error fetching admin/owner users:', uErr)
            return false
        }

        // Filter: Hanya staf cabang yang sama atau owner (branch_id null atau sama)
        const recipients = staffUsers.filter(u => {
            if (u.id === therapistUser?.id) return false
            if (u.role === 'owner') return true // Owner selalu dapat
            return !u.branch_id || u.branch_id === branchId
        })

        if (recipients.length === 0) return false

        const notifTitle = 'Terapis Siap Menerima Pasien ✨'
        const notifMessage = `Terapis ${therapistName} sudah siap di ruangan untuk melayani pasien ${patientName}. Silakan persilakan pasien masuk.`

        const payloads = recipients.map(r => ({
            recipient_id: r.id,
            sender_id: therapistUser?.id || null,
            appointment_id: appointment.id || null,
            type: 'therapist_ready',
            title: notifTitle,
            message: notifMessage
        }))

        const { error } = await supabase.from('notifications').insert(payloads)
        if (error) {
            console.error('Error sending therapist_ready notification:', error.message)
            return false
        }
        return true
    } catch (err) {
        console.error('Failed to notify therapist ready:', err)
        return false
    }
}

/**
 * Kirim notifikasi ke Admin & Owner saat Treatment Selesai (Input Rekam Medis Selesai)
 */
export async function notifyTreatmentCompleted({ supabase, appointment, performerUser }) {
    if (!supabase || !appointment) return false

    try {
        const patientName = appointment.patients?.full_name || 'Pasien'
        const performerName = performerUser?.role === 'therapist' 
            ? `Terapis ${performerUser.full_name}` 
            : `${performerUser?.full_name || 'Staf'} (${performerUser?.role || 'Admin'})`
        const branchId = appointment.branch_id

        const { data: staffUsers } = await supabase
            .from('users')
            .select('id, role, branch_id')
            .in('role', ['admin', 'owner', 'kasir', 'receptionist'])
            .eq('is_active', true)

        const recipients = (staffUsers || []).filter(u => {
            if (u.id === performerUser?.id) return false
            if (u.role === 'owner') return true
            return !u.branch_id || u.branch_id === branchId
        })

        if (recipients.length === 0) return false

        const notifTitle = 'Treatment Selesai 💳'
        const notifMessage = `${performerName} telah menyelesaikan tindakan untuk ${patientName}. Silakan proses pembayaran di Kasir POS.`

        const payloads = recipients.map(r => ({
            recipient_id: r.id,
            sender_id: performerUser?.id || null,
            appointment_id: appointment.id || null,
            type: 'treatment_completed',
            title: notifTitle,
            message: notifMessage
        }))

        const { error } = await supabase.from('notifications').insert(payloads)
        if (error) {
            console.error('Error sending treatment_completed notification:', error.message)
            return false
        }
        return true
    } catch (err) {
        console.error('Failed to notify treatment completed:', err)
        return false
    }
}
