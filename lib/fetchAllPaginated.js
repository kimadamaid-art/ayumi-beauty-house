/**
 * PostgREST memotong setiap jawaban di 1.000 baris tanpa memberi tanda apa pun.
 * Query yang cakupannya luas -- misalnya seluruh tindakan pada rentang tiga bulan --
 * karena itu bisa mengembalikan data yang terpotong diam-diam, dan laporan yang
 * dibangun di atasnya (termasuk komisi terapis) ikut kurang tanpa ada yang sadar.
 *
 * Pemakaian:
 *   const { data, error } = await fetchAllPaginated(() =>
 *       supabase.from('treatment_record_items')
 *           .select('...')
 *           .gte('treatment_records.treatment_date', startDate)
 *           .order('id', { ascending: true })
 *   )
 *
 * Fungsi pembangun query dipanggil ulang untuk setiap halaman, karena satu builder
 * Supabase tidak boleh dipakai dua kali dengan range berbeda.
 *
 * Urutan yang stabil wajib ada pada query -- gunakan kolom unik seperti id, atau
 * tambahkan id sebagai pengurut kedua. Tanpa itu, baris bisa terlewat atau terambil
 * dua kali di antara halaman.
 */
export async function fetchAllPaginated(buildQuery, pageSize = 1000) {
    const rows = []

    for (let from = 0; ; from += pageSize) {
        const { data, error } = await buildQuery().range(from, from + pageSize - 1)

        if (error) {
            // Baris yang sudah terkumpul tetap dikembalikan bersama error, supaya
            // pemanggil bisa memilih: menampilkan sebagian sambil memberi peringatan,
            // atau menolak menampilkan sama sekali.
            return { data: rows, error }
        }

        if (!data || data.length === 0) break
        rows.push(...data)
        if (data.length < pageSize) break
    }

    return { data: rows, error: null }
}
