/**
 * Antrean follow-up CRM setelah treatment.
 *
 * Setiap rekam medis mendapat tiga antrean: 2 minggu, 3 minggu, dan 1 bulan setelah
 * tanggal treatment. Tipenya selalu 'treatment_reminder' karena constraint
 * followup_queue_followup_type_check hanya menerima treatment_reminder, birthday,
 * dormant_reactivation, dan manual. Label tahap (2 Minggu / 3 Minggu / 1 Bulan) di
 * halaman CRM diturunkan dari selisih hari jadwal terhadap tanggal treatment
 * (getEffectiveFollowupType di app/crm/page.js).
 *
 * Dulu halaman rekam medis menyisipkan tipe followup_2minggu dkk., sehingga insert
 * selalu ditolak database dan pasien baru tidak pernah masuk antrean CRM.
 */

export const TREATMENT_FOLLOWUP_DAYS = [14, 21, 30]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Tambah hari ke tanggal 'YYYY-MM-DD' tanpa melibatkan zona waktu.
 * new Date('YYYY-MM-DDT00:00:00') + toISOString() menggeser hasil satu hari ke
 * belakang di WIB; perhitungan UTC murni di sini selalu tepat.
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {number} days
 * @returns {string} 'YYYY-MM-DD'
 */
export function addDaysToDateStr(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * Selisih hari antara dua tanggal 'YYYY-MM-DD' (to - from).
 * @param {string} fromStr
 * @param {string} toStr
 * @returns {number}
 */
export function diffDateStrDays(fromStr, toStr) {
    const toUtc = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
    return Math.round((toUtc(toStr) - toUtc(fromStr)) / 86400000)
}

/**
 * Baris antrean follow-up untuk satu rekam medis.
 * @param {object} params
 * @param {string} params.patientId
 * @param {string} params.treatmentRecordId
 * @param {string} params.branchId       Wajib terisi (kolom NOT NULL).
 * @param {string|null} params.assignedTo Terapis penanggung jawab.
 * @param {string} params.treatmentDate  'YYYY-MM-DD'
 */
export function buildTreatmentFollowups({ patientId, treatmentRecordId, branchId, assignedTo, treatmentDate }) {
    return TREATMENT_FOLLOWUP_DAYS.map(days => ({
        patient_id: patientId,
        treatment_record_id: treatmentRecordId,
        branch_id: branchId,
        assigned_to: assignedTo || null,
        followup_type: 'treatment_reminder',
        scheduled_date: addDaysToDateStr(treatmentDate, days),
        priority: 'normal',
        status: 'pending'
    }))
}

/**
 * Buat antrean follow-up rekam medis bila rekam medis itu belum punya antrean sama
 * sekali. Menyimpan ulang rekam medis yang sama tidak menambah antrean baru.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Parameters<typeof buildTreatmentFollowups>[0]} params
 * @returns {Promise<{ created: number, error: Error|null }>}
 */
export async function ensureTreatmentFollowups(supabase, params) {
    const { patientId, treatmentRecordId, branchId, treatmentDate } = params
    if (!patientId || !treatmentRecordId || !branchId || !DATE_RE.test(treatmentDate || '')) {
        return { created: 0, error: new Error('Data pasien, cabang, atau tanggal treatment belum lengkap.') }
    }

    const { count, error: countErr } = await supabase
        .from('followup_queue')
        .select('id', { count: 'exact', head: true })
        .eq('treatment_record_id', treatmentRecordId)
    if (countErr) return { created: 0, error: countErr }
    if (count > 0) return { created: 0, error: null }

    const rows = buildTreatmentFollowups(params)
    const { error } = await supabase.from('followup_queue').insert(rows)
    return { created: error ? 0 : rows.length, error: error || null }
}

/**
 * Selaraskan antrean follow-up yang masih 'pending' setelah rekam medis diedit:
 * jadwal digeser sejauh perubahan tanggal treatment, dan pasien/cabang/terapis
 * mengikuti data rekam medis terbaru. Antrean yang sudah selesai, dilewati, atau
 * dijadwal ulang tidak diubah. Bila rekam medis belum punya antrean, dibuatkan.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Parameters<typeof buildTreatmentFollowups>[0] & { previousTreatmentDate?: string }} params
 * @returns {Promise<{ created: number, updated: number, error: Error|null }>}
 */
export async function syncTreatmentFollowupsAfterEdit(supabase, params) {
    const { patientId, treatmentRecordId, branchId, assignedTo, treatmentDate, previousTreatmentDate } = params
    if (!patientId || !treatmentRecordId || !branchId || !DATE_RE.test(treatmentDate || '')) {
        return { created: 0, updated: 0, error: new Error('Data pasien, cabang, atau tanggal treatment belum lengkap.') }
    }

    const { data: existing, error: fetchErr } = await supabase
        .from('followup_queue')
        .select('id, status, scheduled_date')
        .eq('treatment_record_id', treatmentRecordId)
    if (fetchErr) return { created: 0, updated: 0, error: fetchErr }

    if (!existing || existing.length === 0) {
        const res = await ensureTreatmentFollowups(supabase, params)
        return { created: res.created, updated: 0, error: res.error }
    }

    const shiftDays = DATE_RE.test(previousTreatmentDate || '')
        ? diffDateStrDays(previousTreatmentDate, treatmentDate)
        : 0

    let updated = 0
    for (const row of existing) {
        if (row.status !== 'pending') continue
        const { error } = await supabase
            .from('followup_queue')
            .update({
                patient_id: patientId,
                branch_id: branchId,
                assigned_to: assignedTo || null,
                scheduled_date: shiftDays ? addDaysToDateStr(row.scheduled_date, shiftDays) : row.scheduled_date
            })
            .eq('id', row.id)
        if (error) return { created: 0, updated, error }
        updated++
    }
    return { created: 0, updated, error: null }
}
