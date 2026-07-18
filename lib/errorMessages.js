/**
 * Helper terpusat untuk menyaring dan menerjemahkan pesan error teknis database
 * menjadi pesan Bahasa Indonesia yang ramah bagi staf non-IT.
 */
export function getFriendlyErrorMessage(error) {
    if (!error) {
        return 'Terjadi kesalahan, silakan coba lagi. Jika masalah berlanjut, hubungi admin.';
    }

    // Ekstrak pesan mentah, kode error, dan detail jika ada
    let message = '';
    let code = '';
    let details = '';

    if (typeof error === 'string') {
        message = error;
    } else if (typeof error === 'object') {
        message = error.message || error.error_description || '';
        code = error.code || '';
        details = error.details || '';
    }

    const lowerMessage = message.toLowerCase();
    const lowerDetails = details ? details.toLowerCase() : '';

    // 1. Pesan Kustom dari Database (RAISE EXCEPTION dalam Bahasa Indonesia)
    // Misalnya: "Stok produk tidak mencukupi", "Tidak diizinkan membuat transaksi untuk cabang lain",
    // atau "Terapis X sudah memiliki jadwal lain yang bertabrakan".
    // Pesan-pesan ini sudah ramah dan berlokal, sehingga diteruskan apa adanya.
    const isCustomIndonesianException =
        lowerMessage.includes('stok') ||
        lowerMessage.includes('tidak diizinkan') ||
        lowerMessage.includes('bertabrakan') ||
        lowerMessage.includes('tabrakan') ||
        lowerMessage.includes('sudah terdaftar') ||
        lowerMessage.includes('tidak ditemukan') ||
        lowerMessage.includes('wajib') ||
        lowerMessage.includes('tidak mencukupi') ||
        lowerMessage.includes('akses ditolak') ||
        lowerMessage.includes('cabang lain') ||
        lowerMessage.includes('terapis');

    if (isCustomIndonesianException) {
        return message;
    }

    // 2. Kode 23505 / "duplicate key" -> Data ganda
    if (code === '23505' || lowerMessage.includes('duplicate key') || lowerDetails.includes('duplicate key') || lowerMessage.includes('23505')) {
        return 'Data ini sudah ada sebelumnya, silakan periksa kembali.';
    }

    // 3. Kode 23503 / "violates foreign key constraint" -> Ketergantungan data referensial
    if (code === '23503' || lowerMessage.includes('foreign key') || lowerDetails.includes('foreign key') || lowerMessage.includes('violates foreign key')) {
        return 'Data terkait masih digunakan di tempat lain, tidak bisa dihapus atau diubah.';
    }

    // 4. "exclusion constraint" / jadwal bentrok (dari trigger database atau kekangan exclusion)
    if (lowerMessage.includes('exclusion constraint') || lowerMessage.includes('overlap') || lowerMessage.includes('no_therapist_overlap')) {
        return 'Jadwal terapis bentrok dengan appointment lain, silakan pilih jam atau terapis lain.';
    }

    // 5. Cek apakah sudah berupa pesan bahasa indonesia yang ramah (misalnya validasi frontend)
    const indonesianKeywords = ['gagal', 'tidak boleh', 'silakan', 'pilih', 'terjadi kesalahan', 'format foto', 'ukuran foto'];
    if (indonesianKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return message;
    }

    // 6. Fallback untuk error teknis/sistem lainnya yang tidak dikenali
    return 'Terjadi kesalahan pada sistem, silakan coba lagi. Jika masalah berlanjut, hubungi admin.';
}
