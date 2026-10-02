'use client'

import { useState } from 'react'

// Foto klinis yang bisa diputar 0/90/180/270 derajat (kolom patient_photos.rotation).
// Bingkainya berukuran tetap (aspect), jadi saat diputar 90/270 kotak gambar ditukar
// lebar-tingginya agar foto tetap memenuhi bingkai.
//
// fit: 'contain' = foto utuh (bisa ada ruang kosong), 'cover' = penuh (tepi bisa terpotong),
// 'auto' = penuh bila bentuk foto (setelah diputar) mirip bingkai, utuh bila tidak.
export const normalizeRotation = (deg) => ((Math.round((Number(deg) || 0) / 90) * 90) % 360 + 360) % 360

export default function RotatedPhoto({ src, alt = '', rotation = 0, aspect = 3 / 4, fit = 'contain', className = '', imgClassName = '' }) {
    const [naturalRatio, setNaturalRatio] = useState(null)
    const deg = normalizeRotation(rotation)
    const sideways = deg === 90 || deg === 270

    let objectFit = fit
    if (fit === 'auto') {
        const shownRatio = naturalRatio ? (sideways ? 1 / naturalRatio : naturalRatio) : null
        objectFit = shownRatio && Math.abs(shownRatio - aspect) / aspect <= 0.25 ? 'cover' : 'contain'
    }

    return (
        <div className={`relative overflow-hidden ${className}`} style={{ aspectRatio: aspect }}>
            <img
                src={src}
                alt={alt}
                loading="lazy"
                onLoad={(e) => {
                    const { naturalWidth, naturalHeight } = e.currentTarget
                    if (naturalWidth && naturalHeight) setNaturalRatio(naturalWidth / naturalHeight)
                }}
                className={`absolute left-1/2 top-1/2 max-w-none transition-[scale] duration-300 ${imgClassName}`}
                style={{
                    width: sideways ? `${100 / aspect}%` : '100%',
                    height: sideways ? `${aspect * 100}%` : '100%',
                    objectFit,
                    transform: `translate(-50%, -50%) rotate(${deg}deg)`
                }}
            />
        </div>
    )
}
