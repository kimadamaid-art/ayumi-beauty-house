/**
 * Tanggal YYYY-MM-DD menurut jam perangkat (WIB bagi pengguna di klinik).
 *
 * new Date().toISOString().split('T')[0] menghasilkan tanggal UTC. Antara
 * 00:00 dan 06:59 WIB tanggal UTC masih hari kemarin, sehingga filter yang
 * dibuka pagi-pagi menampilkan data kemarin. Selama jam buka klinik
 * (08:00-20:00 WIB) keduanya selalu sama, jadi perbedaan ini hanya terasa
 * saat aplikasi dibuka dini hari.
 */
export function toLocalYYYYMMDD(date = new Date()) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}
