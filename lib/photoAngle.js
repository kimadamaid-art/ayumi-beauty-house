// Sudut foto klinis dari caption (foto_depan / foto_kiri / foto_kanan). Caption diutamakan
// karena sudutnya bisa dikoreksi dari galeri pasien, sementara nama file tetap sudut lama.
export function getPhotoAngle(caption, storagePath) {
    const raw = (caption || (storagePath || '').split('/').pop() || '').toLowerCase()
    if (raw.includes('depan') || raw.includes('front')) return 'depan'
    if (raw.includes('kiri') || raw.includes('left')) return 'kiri'
    if (raw.includes('kanan') || raw.includes('right')) return 'kanan'
    return null
}
