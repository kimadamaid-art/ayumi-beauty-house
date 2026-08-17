'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'

export default function CameraCaptureModal({ isOpen, onClose, onCapture, title = 'Ambil Foto Dokumentasi' }) {
    const videoRef = useRef(null)
    const canvasRef = useRef(null)
    const streamRef = useRef(null)

    const [isStreaming, setIsStreaming] = useState(false)
    const [capturedImage, setCapturedImage] = useState(null)
    const [facingMode, setFacingMode] = useState('environment') // 'user' (front) or 'environment' (back)
    const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
    const [errorMsg, setErrorMsg] = useState(null)
    const [flashEffect, setFlashEffect] = useState(false)

    // Stop all media tracks
    const stopStream = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop())
            streamRef.current = null
        }
        setIsStreaming(false)
    }, [])

    // Start media stream
    const startStream = useCallback(async (mode) => {
        stopStream()
        setErrorMsg(null)
        setCapturedImage(null)

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Perangkat atau browser tidak mendukung akses kamera langsung.')
            }

            // Check camera devices
            try {
                const devices = await navigator.mediaDevices.enumerateDevices()
                const videoDevices = devices.filter(d => d.kind === 'videoinput')
                setHasMultipleCameras(videoDevices.length > 1)
            } catch (e) {
                // Ignore enumerate devices error
            }

            const constraints = {
                video: {
                    facingMode: mode ? { ideal: mode } : { ideal: 'environment' },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            }

            const stream = await navigator.mediaDevices.getUserMedia(constraints)
            streamRef.current = stream
            
            if (videoRef.current) {
                videoRef.current.srcObject = stream
                videoRef.current.onloadedmetadata = () => {
                    videoRef.current.play().catch(() => {})
                    setIsStreaming(true)
                }
            }
        } catch (err) {
            console.error('Camera access error:', err)
            let msg = 'Gagal mengakses kamera.'
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                msg = 'Izin kamera ditolak. Silakan izinkan akses kamera di pengaturan browser/perangkat Anda.'
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                msg = 'Kamera tidak ditemukan pada perangkat ini.'
            } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                msg = 'Kamera sedang digunakan oleh aplikasi lain.'
            } else {
                msg = err.message || 'Terjadi kesalahan saat mengaktifkan kamera.'
            }
            setErrorMsg(msg)
            setIsStreaming(false)
        }
    }, [stopStream])

    // Toggle Front / Back camera
    const toggleCamera = () => {
        const nextMode = facingMode === 'environment' ? 'user' : 'environment'
        setFacingMode(nextMode)
        startStream(nextMode)
    }

    // Effect on Open/Close
    useEffect(() => {
        if (isOpen) {
            startStream(facingMode)
        } else {
            stopStream()
            setCapturedImage(null)
            setErrorMsg(null)
        }
        return () => {
            stopStream()
        }
    }, [isOpen, startStream, stopStream])

    // Take photo snapshot
    const takePhoto = () => {
        if (!videoRef.current || !canvasRef.current) return

        const video = videoRef.current
        const canvas = canvasRef.current
        const width = video.videoWidth || 1280
        const height = video.videoHeight || 720

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')

        // If front camera, mirror image for natural selfie feel
        if (facingMode === 'user') {
            ctx.translate(width, 0)
            ctx.scale(-1, 1)
        }

        ctx.drawImage(video, 0, 0, width, height)

        // Shutter flash effect
        setFlashEffect(true)
        setTimeout(() => setFlashEffect(false), 200)

        // Convert to Blob & DataURL
        canvas.toBlob((blob) => {
            if (blob) {
                const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
                const fileName = `camera_${Date.now()}.jpg`
                const file = new File([blob], fileName, { type: 'image/jpeg', lastModified: Date.now() })
                setCapturedImage({ dataUrl, file })
                stopStream()
            }
        }, 'image/jpeg', 0.92)
    }

    // Retake photo
    const handleRetake = () => {
        setCapturedImage(null)
        startStream(facingMode)
    }

    // Confirm and pass file to parent
    const handleConfirm = () => {
        if (capturedImage && capturedImage.file) {
            onCapture(capturedImage.file)
            onClose()
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
            <div className="bg-gray-900 border border-gray-800 w-full max-w-xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
                {/* Header */}
                <div className="flex justify-between items-center px-6 py-4 border-b border-gray-800 bg-gray-900/90">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-pink-500 animate-pulse"></div>
                        <h3 className="font-bold text-white text-base">{title}</h3>
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-gray-400 hover:text-white p-1.5 rounded-full hover:bg-gray-800 transition-colors cursor-pointer"
                        type="button"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Viewport / Body */}
                <div className="relative flex-1 bg-black flex items-center justify-center min-h-[340px] sm:min-h-[420px] overflow-hidden">
                    {/* Hidden Canvas for capture rendering */}
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Flash shutter animation */}
                    {flashEffect && (
                        <div className="absolute inset-0 bg-white z-30 transition-opacity duration-200 pointer-events-none" />
                    )}

                    {errorMsg ? (
                        <div className="p-8 text-center max-w-md mx-auto space-y-4">
                            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <p className="text-gray-300 text-sm leading-relaxed">{errorMsg}</p>
                            <button
                                type="button"
                                onClick={() => startStream(facingMode)}
                                className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer"
                            >
                                Coba Lagi
                            </button>
                        </div>
                    ) : capturedImage ? (
                        /* Captured Preview */
                        <div className="relative w-full h-full flex items-center justify-center">
                            <img 
                                src={capturedImage.dataUrl} 
                                alt="Hasil Tangkapan" 
                                className="w-full h-auto max-h-[60vh] object-contain"
                            />
                            <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-medium text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                Foto Berhasil Diambil
                            </div>
                        </div>
                    ) : (
                        /* Live Stream Video */
                        <div className="relative w-full h-full flex items-center justify-center">
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className={`w-full h-full max-h-[60vh] object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
                            />
                            
                            {/* Framing Overlay Guide for Face / Treatment */}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                <div className="w-64 h-80 sm:w-72 sm:h-96 border-2 border-dashed border-white/40 rounded-[3rem] shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] flex flex-col justify-between p-4">
                                    <span className="text-[10px] uppercase font-bold tracking-wider text-white/70 text-center bg-black/40 py-1 px-2 rounded-full mx-auto backdrop-blur-xs">
                                        Posisikan Wajah / Area Kulit
                                    </span>
                                    <div className="flex justify-between w-full opacity-60 text-white/50 text-[10px] px-1">
                                        <span>+</span>
                                        <span>+</span>
                                    </div>
                                </div>
                            </div>

                            {/* Camera Switch Button (Top Right over video) */}
                            <button
                                type="button"
                                onClick={toggleCamera}
                                title="Ganti Kamera Depan/Belakang"
                                className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 backdrop-blur-md text-white p-3 rounded-full border border-white/20 transition-all active:scale-95 z-20 shadow-lg flex items-center gap-2 cursor-pointer"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                <span className="text-xs font-semibold hidden sm:inline">
                                    {facingMode === 'environment' ? 'Kamera Belakang' : 'Kamera Depan'}
                                </span>
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer Controls */}
                <div className="px-6 py-5 bg-gray-900 border-t border-gray-800 flex items-center justify-between gap-4">
                    {capturedImage ? (
                        <>
                            <button
                                type="button"
                                onClick={handleRetake}
                                className="flex-1 py-3 px-5 rounded-2xl bg-gray-800 hover:bg-gray-700 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Ambil Ulang
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirm}
                                className="flex-1 py-3 px-5 rounded-2xl bg-gradient-to-r from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700 text-white font-bold text-sm transition-all shadow-lg shadow-pink-500/25 flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                </svg>
                                Gunakan Foto Ini
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={onClose}
                                className="py-3 px-6 rounded-2xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold text-sm transition-all cursor-pointer"
                            >
                                Batal
                            </button>

                            {/* Shutter Capture Button */}
                            <div className="flex-1 flex justify-center">
                                <button
                                    type="button"
                                    onClick={takePhoto}
                                    disabled={!isStreaming || errorMsg}
                                    title="Jepret Foto"
                                    className="w-16 h-16 rounded-full border-4 border-white p-1 flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl disabled:opacity-40 disabled:cursor-not-allowed group cursor-pointer"
                                >
                                    <div className="w-full h-full bg-pink-500 group-hover:bg-pink-600 rounded-full transition-colors flex items-center justify-center">
                                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </div>
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={toggleCamera}
                                className="p-3 rounded-2xl bg-gray-800 hover:bg-gray-700 text-gray-300 transition-all sm:hidden cursor-pointer"
                                title="Ganti Kamera"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
