'use client'

// Foto klinis yang bisa diputar 0/90/180/270 derajat (kolom patient_photos.rotation).
// Bingkainya berukuran tetap (aspect), jadi saat diputar 90/270 kotak gambar ditukar
// lebar-tingginya agar foto tetap memenuhi bingkai tanpa terpotong.
export const normalizeRotation = (deg) => ((Math.round((Number(deg) || 0) / 90) * 90) % 360 + 360) % 360

export default function RotatedPhoto({ src, alt = '', rotation = 0, aspect = 3 / 4, className = '', imgClassName = '' }) {
    const deg = normalizeRotation(rotation)
    const sideways = deg === 90 || deg === 270

    return (
        <div className={`relative overflow-hidden ${className}`} style={{ aspectRatio: aspect }}>
            <img
                src={src}
                alt={alt}
                loading="lazy"
                className={`absolute left-1/2 top-1/2 object-contain transition-transform duration-300 ${imgClassName}`}
                style={{
                    width: sideways ? `${100 / aspect}%` : '100%',
                    height: sideways ? `${aspect * 100}%` : '100%',
                    transform: `translate(-50%, -50%) rotate(${deg}deg)`
                }}
            />
        </div>
    )
}
