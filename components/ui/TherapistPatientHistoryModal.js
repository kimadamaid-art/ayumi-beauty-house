'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'

export default function TherapistPatientHistoryModal({ patientId, isOpen, onClose, initialTab = 'records' }) {
    const [loading, setLoading] = useState(true)
    const [patient, setPatient] = useState(null)
    const [records, setRecords] = useState([])
    const [photos, setPhotos] = useState([])
    const [coupons, setCoupons] = useState([])
    const [activeTab, setActiveTab] = useState(initialTab) // 'records' | 'photos' | 'coupons' | 'compare'
    const [photoAngleFilter, setPhotoAngleFilter] = useState('all') // 'all' | 'depan' | 'kiri' | 'kanan'
    const [selectedPhotoZoom, setSelectedPhotoZoom] = useState(null)

    // Comparison Mode State
    const [comparePhoto1, setComparePhoto1] = useState(null)
    const [comparePhoto2, setComparePhoto2] = useState(null)

    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab || 'records')
        }
    }, [isOpen, initialTab])

    useEffect(() => {
        if (!isOpen || !patientId) return

        const fetchPatientDetails = async () => {
            setLoading(true)
            try {
                const res = await fetch(`/api/therapist/patient-history?patientId=${patientId}`)
                if (!res.ok) throw new Error('Gagal memuat data pasien')
                const data = await res.json()

                if (data.patient) setPatient(data.patient)
                if (data.records) setRecords(data.records)
                if (data.coupons) setCoupons(data.coupons)

                if (data.photos) {
                    const photosWithUrls = data.photos.map(p => {
                        let fullUrl = p.fullUrl || p.photo_url || p.image_url || p.storage_path
                        if (fullUrl && !fullUrl.startsWith('http')) {
                            const { data: pubUrl } = supabase.storage.from('patient-photos').getPublicUrl(fullUrl)
                            fullUrl = pubUrl?.publicUrl || fullUrl
                        }
                        return { ...p, fullUrl }
                    })
                    setPhotos(photosWithUrls)

                    // Pre-select comparison photos if available (oldest vs newest)
                    if (photosWithUrls.length >= 2) {
                        setComparePhoto1(photosWithUrls[photosWithUrls.length - 1]) // oldest
                        setComparePhoto2(photosWithUrls[0]) // newest
                    } else if (photosWithUrls.length === 1) {
                        setComparePhoto1(photosWithUrls[0])
                        setComparePhoto2(null)
                    }
                }

            } catch (err) {
                console.error('Error fetching therapist patient details:', err)
            } finally {
                setLoading(false)
            }
        }

        fetchPatientDetails()
    }, [isOpen, patientId])

    if (!isOpen) return null

    // Calculate age if birth_date exists
    const getAge = (birthDateStr) => {
        if (!birthDateStr) return null
        const birth = new Date(birthDateStr)
        const today = new Date()
        let age = today.getFullYear() - birth.getFullYear()
        const m = today.getMonth() - birth.getMonth()
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
            age--
        }
        return age
    }

    const getPhotoAngleCategory = (caption, storagePath) => {
        const raw = (caption || storagePath || '').toLowerCase()
        if (raw.includes('depan') || raw.includes('front')) return 'depan'
        if (raw.includes('kiri') || raw.includes('left')) return 'kiri'
        if (raw.includes('kanan') || raw.includes('right')) return 'kanan'
        return 'other'
    }

    const formatPhotoLabel = (caption, storagePath) => {
        const cat = getPhotoAngleCategory(caption, storagePath)
        if (cat === 'depan') return 'Foto Depan'
        if (cat === 'kiri') return 'Foto Samping Kiri'
        if (cat === 'kanan') return 'Foto Samping Kanan'
        return caption || 'Foto Dokumentasi'
    }

    const filteredPhotos = photos.filter(p => {
        if (photoAngleFilter === 'all') return true
        const cat = getPhotoAngleCategory(p.caption, p.storage_path)
        return cat === photoAngleFilter
    })

    // Group photos by treatment date
    const photosByDate = filteredPhotos.reduce((acc, p) => {
        const dateKey = p.treatment_records?.treatment_date 
            ? p.treatment_records.treatment_date
            : (p.created_at ? p.created_at.split('T')[0] : 'Lainnya')
        if (!acc[dateKey]) acc[dateKey] = []
        acc[dateKey].push(p)
        return acc
    }, {})

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
            <div className="bg-white w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] border border-gray-100">
                {/* Header */}
                <div className="px-5 sm:px-6 py-4 bg-gradient-to-r from-pink-50 via-white to-pink-50/40 border-b border-pink-100 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-ayumi-primary to-pink-600 text-white font-black text-lg flex items-center justify-center shadow-md">
                            {patient?.full_name ? patient.full_name.charAt(0).toUpperCase() : 'P'}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="font-extrabold text-gray-900 text-base sm:text-lg leading-tight">
                                    {patient?.full_name || 'Memuat Pasien...'}
                                </h3>
                                {patient?.gender && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-pink-100 text-ayumi-primary uppercase">
                                        {patient.gender === 'female' ? 'Wanita' : 'Pria'}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-gray-500 font-medium mt-0.5">
                                {patient?.birth_date && (
                                    <span>Usia: <strong>{getAge(patient.birth_date)} Thn</strong></span>
                                )}
                                <span>Total Treatment: <strong>{records.length} Sesi</strong></span>
                                <span>Total Foto: <strong>{photos.length} Foto</strong></span>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
                        title="Tutup"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Subtabs Header */}
                <div className="flex border-b border-gray-100 bg-gray-50/80 px-4 sm:px-6 pt-2 gap-1.5 overflow-x-auto custom-scrollbar">
                    <button
                        type="button"
                        onClick={() => setActiveTab('records')}
                        className={`py-2.5 px-3.5 font-bold text-xs rounded-t-xl transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                            activeTab === 'records'
                                ? 'bg-white text-ayumi-primary border-t-2 border-ayumi-primary shadow-xs font-extrabold'
                                : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        <span>📝</span> Riwayat SOAP ({records.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('photos')}
                        className={`py-2.5 px-3.5 font-bold text-xs rounded-t-xl transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                            activeTab === 'photos'
                                ? 'bg-white text-ayumi-primary border-t-2 border-ayumi-primary shadow-xs font-extrabold'
                                : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        <span>📸</span> Galeri Foto ({photos.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('compare')}
                        className={`py-2.5 px-3.5 font-bold text-xs rounded-t-xl transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                            activeTab === 'compare'
                                ? 'bg-white text-purple-700 border-t-2 border-purple-600 shadow-xs font-extrabold'
                                : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        <span>🔬</span> Komparasi Progress ({photos.length >= 2 ? 'Siap' : '1 Foto'})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('coupons')}
                        className={`py-2.5 px-3.5 font-bold text-xs rounded-t-xl transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                            activeTab === 'coupons'
                                ? 'bg-white text-ayumi-primary border-t-2 border-ayumi-primary shadow-xs font-extrabold'
                                : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        <span>🎟️</span> Kupon Paket ({coupons.length})
                    </button>
                </div>

                {/* Body Content */}
                <div className="flex-1 p-4 sm:p-6 overflow-y-auto custom-scrollbar bg-gray-50/30">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
                            <div className="w-8 h-8 border-3 border-ayumi-primary border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-xs font-semibold">Memuat rekam medis & riwayat foto pasien...</span>
                        </div>
                    ) : (
                        <>
                            {/* TAB 1: RIWAYAT TREATMENT & SOAP */}
                            {activeTab === 'records' && (
                                <div className="space-y-4">
                                    {records.length === 0 ? (
                                        <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 p-6">
                                            <div className="text-3xl mb-2">📋</div>
                                            <p className="font-bold text-gray-700 text-sm">Belum Ada Riwayat Treatment</p>
                                            <p className="text-xs text-gray-400 mt-1">Pasien ini belum memiliki catatan rekam medis sebelumnya.</p>
                                        </div>
                                    ) : (
                                        records.map((r, idx) => {
                                            const performerName = r.performer?.full_name || r.users?.full_name
                                            return (
                                                <div key={r.id} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs hover:border-pink-200 transition-all space-y-3">
                                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="w-6 h-6 rounded-full bg-pink-100 text-ayumi-primary text-xs font-extrabold flex items-center justify-center">
                                                                {idx + 1}
                                                            </span>
                                                            <div className="font-extrabold text-gray-900 text-sm">
                                                                {new Date(r.treatment_date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                                                            </div>
                                                            {r.treatment_time && (
                                                                <span className="text-xs font-semibold text-gray-400">
                                                                    • {r.treatment_time.substring(0, 5)} WIB
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-gray-500 font-medium">
                                                            Cabang: <strong className="text-gray-700">{r.branches?.name || '-'}</strong>
                                                            {performerName && (
                                                                <span className="ml-2 pl-2 border-l border-gray-200">
                                                                    Terapis: <strong className="text-ayumi-primary">{performerName}</strong>
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Treatments Done */}
                                                    <div>
                                                        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Tindakan Treatment</div>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {r.treatment_record_items?.map(it => (
                                                                <span key={it.id} className="px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-extrabold rounded-lg border border-purple-100">
                                                                    {it.treatments?.name || 'Treatment'}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* SOAP Details Grid */}
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-gray-50/70 p-3.5 rounded-xl border border-gray-100 text-xs">
                                                        {r.complaints && (
                                                            <div>
                                                                <span className="font-bold text-gray-700 block mb-0.5">🗣️ Keluhan (S):</span>
                                                                <p className="text-gray-600 leading-relaxed">{r.complaints}</p>
                                                            </div>
                                                        )}
                                                        {r.skin_condition && (
                                                            <div>
                                                                <span className="font-bold text-gray-700 block mb-0.5">🔍 Kondisi Kulit (O):</span>
                                                                <p className="text-gray-600 leading-relaxed">{r.skin_condition}</p>
                                                            </div>
                                                        )}
                                                        {r.result_notes && (
                                                            <div>
                                                                <span className="font-bold text-gray-700 block mb-0.5">📝 Catatan Tindakan (A):</span>
                                                                <p className="text-gray-600 leading-relaxed">{r.result_notes}</p>
                                                            </div>
                                                        )}
                                                        {r.recommendation && (
                                                            <div>
                                                                <span className="font-bold text-gray-700 block mb-0.5">💡 Rekomendasi/Homecare (P):</span>
                                                                <p className="text-gray-600 leading-relaxed">{r.recommendation}</p>
                                                            </div>
                                                        )}
                                                        {!r.complaints && !r.skin_condition && !r.result_notes && !r.recommendation && (
                                                            <div className="col-span-2 text-gray-400 italic">
                                                                Tidak ada catatan SOAP tertulis pada sesi ini.
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Foto Dokumentasi Sesi Ini jika ada */}
                                                    {r.photos && r.photos.length > 0 && (
                                                        <div className="pt-1">
                                                            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center justify-between">
                                                                <span className="flex items-center gap-1">📸 Foto Sesi Ini ({r.photos.length})</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setActiveTab('photos')
                                                                    }}
                                                                    className="text-ayumi-primary hover:underline text-[11px] font-bold"
                                                                >
                                                                    Lihat di Galeri ↗
                                                                </button>
                                                            </div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {r.photos.map(p => (
                                                                    <div
                                                                        key={p.id}
                                                                        onClick={() => setSelectedPhotoZoom(p.fullUrl)}
                                                                        className="relative w-20 h-20 rounded-xl overflow-hidden border border-pink-200 cursor-pointer group shadow-2xs hover:scale-105 transition-transform"
                                                                    >
                                                                        <img
                                                                            src={p.fullUrl}
                                                                            alt={p.caption || 'Foto'}
                                                                            className="w-full h-full object-cover"
                                                                        />
                                                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold text-center p-1">
                                                                            {formatPhotoLabel(p.caption, p.storage_path)}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            )}

                            {/* TAB 2: GALERI FOTO (DENGAN FILTER SUDUT & GROUPING TANGGAL) */}
                            {activeTab === 'photos' && (
                                <div className="space-y-4">
                                    {/* Filter Sudut Pengambilan Foto */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3 rounded-2xl border border-gray-100 shadow-2xs">
                                        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5">
                                            {[
                                                { key: 'all', label: 'Semua Sudut', icon: '🖼️' },
                                                { key: 'depan', label: 'Tampak Depan', icon: '👤' },
                                                { key: 'kiri', label: 'Samping Kiri', icon: '👈' },
                                                { key: 'kanan', label: 'Samping Kanan', icon: '👉' }
                                            ].map(btn => (
                                                <button
                                                    key={btn.key}
                                                    type="button"
                                                    onClick={() => setPhotoAngleFilter(btn.key)}
                                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer shrink-0 ${
                                                        photoAngleFilter === btn.key
                                                            ? 'bg-ayumi-primary text-white shadow-xs font-black'
                                                            : 'bg-gray-50 hover:bg-gray-100 text-gray-600'
                                                    }`}
                                                >
                                                    <span>{btn.icon}</span>
                                                    <span>{btn.label}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                                                        photoAngleFilter === btn.key ? 'bg-white/30 text-white' : 'bg-gray-200 text-gray-700'
                                                    }`}>
                                                        {btn.key === 'all' 
                                                            ? photos.length 
                                                            : photos.filter(p => getPhotoAngleCategory(p.caption, p.storage_path) === btn.key).length
                                                        }
                                                    </span>
                                                </button>
                                            ))}
                                        </div>

                                        {photos.length >= 2 && (
                                            <button
                                                type="button"
                                                onClick={() => setActiveTab('compare')}
                                                className="px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer ml-auto shrink-0"
                                            >
                                                <span>🔬</span>
                                                <span>Mode Bandingkan (Side-by-Side)</span>
                                            </button>
                                        )}
                                    </div>

                                    {filteredPhotos.length === 0 ? (
                                        <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 p-6">
                                            <div className="text-3xl mb-2">📸</div>
                                            <p className="font-bold text-gray-700 text-sm">Tidak Ada Foto Ditemukan</p>
                                            <p className="text-xs text-gray-400 mt-1">
                                                {photoAngleFilter === 'all'
                                                    ? 'Belum ada foto dokumentasi medis yang diunggah untuk pasien ini.'
                                                    : `Belum ada foto dengan sudut "${photoAngleFilter}" yang tersimpan.`}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-6">
                                            {Object.keys(photosByDate).map(dateKey => {
                                                const datePhotos = photosByDate[dateKey]
                                                const formattedDate = dateKey !== 'Lainnya'
                                                    ? new Date(dateKey + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                                                    : 'Dokumentasi Lainnya'

                                                return (
                                                    <div key={dateKey} className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-xs space-y-3">
                                                        <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                                                            <div className="flex items-center gap-2">
                                                                <span className="w-2.5 h-2.5 rounded-full bg-ayumi-primary"></span>
                                                                <h4 className="font-black text-gray-800 text-sm">{formattedDate}</h4>
                                                                {datePhotos[0]?.treatment_records?.branches?.name && (
                                                                    <span className="text-xs text-gray-400">• {datePhotos[0].treatment_records.branches.name}</span>
                                                                )}
                                                            </div>
                                                            <span className="text-xs text-ayumi-primary font-bold bg-pink-50 px-2.5 py-0.5 rounded-full border border-pink-100">
                                                                {datePhotos.length} Foto Sesi
                                                            </span>
                                                        </div>

                                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                                            {datePhotos.map(photo => {
                                                                const label = formatPhotoLabel(photo.caption, photo.storage_path)
                                                                const angle = getPhotoAngleCategory(photo.caption, photo.storage_path)
                                                                return (
                                                                    <div 
                                                                        key={photo.id}
                                                                        onClick={() => setSelectedPhotoZoom(photo.fullUrl)}
                                                                        className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-2xs hover:shadow-md hover:border-pink-300 transition-all cursor-pointer group flex flex-col relative"
                                                                    >
                                                                        <div className="relative aspect-square overflow-hidden bg-gray-100">
                                                                            <img 
                                                                                src={photo.fullUrl} 
                                                                                alt={photo.caption || 'Dokumentasi Pasien'} 
                                                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                                            />
                                                                            <div className="absolute top-2 left-2">
                                                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md shadow-xs text-white ${
                                                                                    angle === 'depan' ? 'bg-blue-600' : angle === 'kiri' ? 'bg-emerald-600' : angle === 'kanan' ? 'bg-amber-600' : 'bg-gray-600'
                                                                                }`}>
                                                                                    {label}
                                                                                </span>
                                                                            </div>
                                                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1">
                                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
                                                                                Perbesar
                                                                            </div>
                                                                        </div>

                                                                        {/* Quick Select for Compare */}
                                                                        <div className="p-2 bg-gray-50 flex items-center justify-between border-t border-gray-100">
                                                                            <span className="text-[10px] text-gray-500 truncate">
                                                                                {new Date(photo.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB
                                                                            </span>
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation()
                                                                                    if (!comparePhoto1) setComparePhoto1(photo)
                                                                                    else setComparePhoto2(photo)
                                                                                    setActiveTab('compare')
                                                                                }}
                                                                                className="text-[10px] font-extrabold text-purple-700 hover:text-purple-900 hover:underline"
                                                                            >
                                                                                + Bandingkan
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* TAB 3: MODE KOMPARASI PROGRESS (SIDE-BY-SIDE) */}
                            {activeTab === 'compare' && (
                                <div className="space-y-4">
                                    <div className="bg-purple-50/70 p-4 rounded-2xl border border-purple-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div>
                                            <h4 className="font-extrabold text-purple-950 text-sm flex items-center gap-1.5">
                                                <span>🔬</span> Komparasi Progress Kondisi Kulit Pasien (Before vs After)
                                            </h4>
                                            <p className="text-xs text-purple-700 mt-0.5">
                                                Pilih dua foto dari sesi/tanggal berbeda di bawah untuk membandingkan perkembangan kulit pasien secara berdampingan.
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    // Swap
                                                    const temp = comparePhoto1
                                                    setComparePhoto1(comparePhoto2)
                                                    setComparePhoto2(temp)
                                                }}
                                                className="px-3 py-1.5 bg-white hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer flex items-center gap-1"
                                                title="Tukar Posisi"
                                            >
                                                <span>⇄</span> Tukar
                                            </button>
                                        </div>
                                    </div>

                                    {/* Side by Side Frame */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {/* Foto 1 (Before / Sesi Awal) */}
                                        <div className="bg-white rounded-2xl p-4 border-2 border-indigo-200 shadow-xs space-y-3">
                                            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                                                <span className="text-xs font-black uppercase text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">
                                                    Foto 1 (Sesi Sebelumnya)
                                                </span>
                                                <select
                                                    value={comparePhoto1?.id || ''}
                                                    onChange={(e) => {
                                                        const match = photos.find(p => p.id === e.target.value)
                                                        if (match) setComparePhoto1(match)
                                                    }}
                                                    className="text-xs font-bold border border-gray-200 rounded-xl px-2 py-1 max-w-[180px] bg-white text-gray-800 outline-none"
                                                >
                                                    <option value="" disabled>-- Pilih Foto 1 --</option>
                                                    {photos.map((p) => {
                                                        const pDate = p.treatment_records?.treatment_date || p.created_at?.split('T')[0]
                                                        return (
                                                            <option key={p.id} value={p.id}>
                                                                {pDate} - {formatPhotoLabel(p.caption, p.storage_path)}
                                                            </option>
                                                        )
                                                    })}
                                                </select>
                                            </div>

                                            {comparePhoto1 ? (
                                                <div className="space-y-2">
                                                    <div 
                                                        onClick={() => setSelectedPhotoZoom(comparePhoto1.fullUrl)}
                                                        className="relative w-full h-64 sm:h-72 bg-gray-100 rounded-xl overflow-hidden border border-gray-200 shadow-inner cursor-pointer group"
                                                    >
                                                        <img
                                                            src={comparePhoto1.fullUrl}
                                                            alt="Foto 1"
                                                            className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                                                        />
                                                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1">
                                                            <span>🔍 Perbesar</span>
                                                        </div>
                                                    </div>
                                                    <div className="bg-gray-50 p-2.5 rounded-xl text-xs space-y-1">
                                                        <div className="flex justify-between font-bold text-gray-800">
                                                            <span>{formatPhotoLabel(comparePhoto1.caption, comparePhoto1.storage_path)}</span>
                                                            <span className="text-indigo-600">
                                                                {comparePhoto1.treatment_records?.treatment_date 
                                                                    ? new Date(comparePhoto1.treatment_records.treatment_date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                                                                    : new Date(comparePhoto1.created_at).toLocaleDateString('id-ID')
                                                                }
                                                            </span>
                                                        </div>
                                                        {comparePhoto1.treatment_records?.branches?.name && (
                                                            <p className="text-[11px] text-gray-500">Cabang: {comparePhoto1.treatment_records.branches.name}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="h-64 sm:h-72 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center text-gray-400 p-4 text-center">
                                                    <span>📸</span>
                                                    <span className="text-xs font-bold mt-1">Pilih foto pertama dari dropdown di atas</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Foto 2 (After / Sesi Terbaru) */}
                                        <div className="bg-white rounded-2xl p-4 border-2 border-purple-200 shadow-xs space-y-3">
                                            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                                                <span className="text-xs font-black uppercase text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-100">
                                                    Foto 2 (Sesi Lanjutan / Terkini)
                                                </span>
                                                <select
                                                    value={comparePhoto2?.id || ''}
                                                    onChange={(e) => {
                                                        const match = photos.find(p => p.id === e.target.value)
                                                        if (match) setComparePhoto2(match)
                                                    }}
                                                    className="text-xs font-bold border border-gray-200 rounded-xl px-2 py-1 max-w-[180px] bg-white text-gray-800 outline-none"
                                                >
                                                    <option value="" disabled>-- Pilih Foto 2 --</option>
                                                    {photos.map((p) => {
                                                        const pDate = p.treatment_records?.treatment_date || p.created_at?.split('T')[0]
                                                        return (
                                                            <option key={p.id} value={p.id}>
                                                                {pDate} - {formatPhotoLabel(p.caption, p.storage_path)}
                                                            </option>
                                                        )
                                                    })}
                                                </select>
                                            </div>

                                            {comparePhoto2 ? (
                                                <div className="space-y-2">
                                                    <div 
                                                        onClick={() => setSelectedPhotoZoom(comparePhoto2.fullUrl)}
                                                        className="relative w-full h-64 sm:h-72 bg-gray-100 rounded-xl overflow-hidden border border-gray-200 shadow-inner cursor-pointer group"
                                                    >
                                                        <img
                                                            src={comparePhoto2.fullUrl}
                                                            alt="Foto 2"
                                                            className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                                                        />
                                                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1">
                                                            <span>🔍 Perbesar</span>
                                                        </div>
                                                    </div>
                                                    <div className="bg-gray-50 p-2.5 rounded-xl text-xs space-y-1">
                                                        <div className="flex justify-between font-bold text-gray-800">
                                                            <span>{formatPhotoLabel(comparePhoto2.caption, comparePhoto2.storage_path)}</span>
                                                            <span className="text-purple-600">
                                                                {comparePhoto2.treatment_records?.treatment_date 
                                                                    ? new Date(comparePhoto2.treatment_records.treatment_date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                                                                    : new Date(comparePhoto2.created_at).toLocaleDateString('id-ID')
                                                                }
                                                            </span>
                                                        </div>
                                                        {comparePhoto2.treatment_records?.branches?.name && (
                                                            <p className="text-[11px] text-gray-500">Cabang: {comparePhoto2.treatment_records.branches.name}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="h-64 sm:h-72 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center text-gray-400 p-4 text-center">
                                                    <span>📸</span>
                                                    <span className="text-xs font-bold mt-1">Pilih foto kedua dari dropdown di atas</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TAB 4: KUPON PAKET */}
                            {activeTab === 'coupons' && (
                                <div className="space-y-4">
                                    {coupons.length === 0 ? (
                                        <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 p-6">
                                            <div className="text-3xl mb-2">🎟️</div>
                                            <p className="font-bold text-gray-700 text-sm">Tidak Ada Kupon Paket Aktif</p>
                                            <p className="text-xs text-gray-400 mt-1">Pasien tidak memiliki paket kupon aktif saat ini.</p>
                                        </div>
                                    ) : (
                                        coupons.map(cp => (
                                            <div key={cp.id} className="bg-white rounded-2xl p-5 border border-pink-100 shadow-xs">
                                                <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-3">
                                                    <h4 className="font-extrabold text-gray-900 text-sm flex items-center gap-1.5">
                                                        <span>🎫</span> {cp.coupon_packages?.name || 'Paket Kupon'}
                                                    </h4>
                                                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                                                        Aktif
                                                    </span>
                                                </div>

                                                <div className="space-y-2">
                                                    {cp.patient_coupon_items?.map(it => (
                                                        <div key={it.id} className="flex items-center justify-between text-xs bg-pink-50/50 p-2.5 rounded-xl border border-pink-100/70">
                                                            <span className="font-bold text-gray-800">
                                                                {it.treatments?.name || 'Treatment'}
                                                            </span>
                                                            <div className="text-right">
                                                                <span className="font-extrabold text-ayumi-primary">
                                                                    Sisa {it.remaining_sessions} / {it.total_sessions} Sesi
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn-secondary px-6 py-2 text-xs font-bold cursor-pointer"
                    >
                        Tutup
                    </button>
                </div>
            </div>

            {/* Photo Zoom Lightbox Modal */}
            {selectedPhotoZoom && (
                <div 
                    className="fixed inset-0 z-60 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
                    onClick={() => setSelectedPhotoZoom(null)}
                >
                    <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
                        <img 
                            src={selectedPhotoZoom} 
                            alt="Foto Zoom" 
                            className="max-h-[80vh] w-auto object-contain rounded-2xl shadow-2xl"
                        />
                        <button
                            type="button"
                            onClick={() => setSelectedPhotoZoom(null)}
                            className="mt-4 px-6 py-2 bg-white/20 hover:bg-white/30 text-white rounded-full text-xs font-bold transition-all backdrop-blur-xs cursor-pointer"
                        >
                            Tutup Preview (Esc / Klik Luar)
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
