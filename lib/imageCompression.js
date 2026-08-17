/**
 * Helper Kompresi Gambar Client-Side untuk Foto Medis Pasien Ayumi Beauty House
 * Standar: Maksimal Sisi Terpanjang 1600px, Format WebP Kualitas 80% (0.8)
 * Menghemat kapasitas Supabase Storage hingga 13x lipat (~4MB -> ~300KB)
 */

export async function compressImageForMedical(file, maxWidth = 1600, quality = 0.8) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
        return file
    }

    return new Promise((resolve) => {
        const reader = new FileReader()
        reader.readAsDataURL(file)
        reader.onload = (event) => {
            const img = new Image()
            img.src = event.target.result
            img.onload = () => {
                const canvas = document.createElement('canvas')
                let { width, height } = img

                // Hitung dimensi rasio terkunci dengan batas maksimal 1600px
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width)
                        width = maxWidth
                    }
                } else {
                    if (height > maxWidth) {
                        width = Math.round((width * maxWidth) / height)
                        height = maxWidth
                    }
                }

                canvas.width = width
                canvas.height = height
                const ctx = canvas.getContext('2d')
                
                // Gambar ke canvas dengan interpolasi halus
                ctx.imageSmoothingEnabled = true
                ctx.imageSmoothingQuality = 'high'
                ctx.drawImage(img, 0, 0, width, height)

                // Konversi ke format WebP terkompresi
                canvas.toBlob((blob) => {
                    if (!blob) {
                        // Fallback jika browser gagal mengonversi blob
                        return resolve(file)
                    }

                    const originalName = file.name.replace(/\.[^/.]+$/, "")
                    const compressedFile = new File([blob], `${originalName}.webp`, {
                        type: 'image/webp',
                        lastModified: Date.now(),
                    })

                    resolve(compressedFile)
                }, 'image/webp', quality)
            }
            img.onerror = () => {
                // Fallback jika gambar rusak
                resolve(file)
            }
        }
        reader.onerror = () => {
            resolve(file)
        }
    })
}
