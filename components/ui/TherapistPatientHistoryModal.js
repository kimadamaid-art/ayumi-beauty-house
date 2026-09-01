'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'

export default function TherapistPatientHistoryModal({ patientId, isOpen, onClose }) {
    const [loading, setLoading] = useState(true)
    const [patient, setPatient] = useState(null)
    const [records, setRecords] = useState([])
    const [photos, setPhotos] = useState([])
    const [coupons, setCoupons] = useState([])
    const [activeTab, setActiveTab] = useState('records') // 'records' | 'photos' | 'coupons'
    const [selectedPhotoZoom, setSelectedPhotoZoom] = useState(null)

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

    const formatPhotoLabel = (caption, storagePath) => {
        const raw = (caption || storagePath || '').toLowerCase()
        if (raw.includes('depan') || raw.includes('front')) return 'Foto Depan'
        if (raw.includes('kiri') || raw.includes('left')) return 'Foto Samping Kiri'
        if (raw.includes('kanan') || raw.includes('right')) return 'Foto Samping Kanan'
        return caption || 'Foto Dokumentasi'
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
            <div className="bg-white w-full max-w-3xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] border border-gray-100">
                {/* Header */}
                <div className="px-6 py-5 bg-gradient-to-r from-pink-50 via-white to-pink-50/30 border-b border-pink-100 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-ayumi-primary to-pink-600 text-white font-black text-lg flex items-center justify-center shadow-md">
                            {patient?.full_name ? patient.full_name.charAt(0).toUpperCase() : 'P'}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="font-extrabold text-gray-900 text-lg leading-tight">
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
                <div className="flex border-b border-gray-100 bg-gray-50/80 px-6 pt-2 gap-2">
                    <button
                        type="button"
                        onClick={() => setActiveTab('records')}
                        className={`py-2.5 px-4 font-bold text-xs rounded-t-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                            activeTab === 'records'
                                ? 'bg-white text-ayumi-primary border-t-2 border-ayumi-primary shadow-xs font-extrabold'
                                : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        <span>📝</span> Riwayat Treatment & SOAP ({records.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('photos')}
                        className={`py-2.5 px-4 font-bold text-xs rounded-t-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                            activeTab === 'photos'
                                ? 'bg-white text-ayumi-primary border-t-2 border-ayumi-primary shadow-xs font-extrabold'
                                : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        <span>📸</span> Galeri Foto ({photos.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('coupons')}
                        className={`py-2.5 px-4 font-bold text-xs rounded-t-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                            activeTab === 'coupons'
                                ? 'bg-white text-ayumi-primary border-t-2 border-ayumi-primary shadow-xs font-extrabold'
                                : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        <span>🎟️</span> Kupon Paket ({coupons.length})
                    </button>
                </div>

                {/* Body Content */}
                <div className="flex-1 p-6 overflow-y-auto custom-scrollbar bg-gray-50/30">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
                            <div className="w-8 h-8 border-3 border-ayumi-primary border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-xs font-semibold">Memuat data rekam medis pasien...</span>
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
                                                            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1">
                                                                <span>📸</span> Foto Sesi Ini ({r.photos.length})
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
                                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold text-center p-1">
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

                            {/* TAB 2: GALERI FOTO */}
                            {activeTab === 'photos' && (
                                <div>
                                    {photos.length === 0 ? (
                                        <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 p-6">
                                            <div className="text-3xl mb-2">📸</div>
                                            <p className="font-bold text-gray-700 text-sm">Belum Ada Foto Dokumentasi</p>
                                            <p className="text-xs text-gray-400 mt-1">Belum ada foto kondisi kulit atau before/after yang diunggah untuk pasien ini.</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                            {photos.map(photo => (
                                                <div 
                                                    key={photo.id}
                                                    onClick={() => setSelectedPhotoZoom(photo.fullUrl)}
                                                    className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-xs hover:shadow-md hover:border-pink-300 transition-all cursor-pointer group flex flex-col"
                                                >
                                                    <div className="relative aspect-square overflow-hidden bg-gray-100">
                                                        <img 
                                                            src={photo.fullUrl} 
                                                            alt={photo.caption || 'Dokumentasi Pasien'} 
                                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                        />
                                                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1">
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
                                                            Perbesar
                                                        </div>
                                                    </div>
                                                    <div className="p-2 text-center bg-white">
                                                        <span className="text-[10px] font-extrabold text-gray-700 uppercase block truncate">
                                                            {formatPhotoLabel(photo.caption, photo.storage_path)}
                                                        </span>
                                                        <span className="text-[9px] text-gray-400 block mt-0.5">
                                                            {photo.treatment_records?.treatment_date 
                                                                ? new Date(photo.treatment_records.treatment_date + 'T00:00:00').toLocaleDateString('id-ID')
                                                                : new Date(photo.created_at).toLocaleDateString('id-ID')
                                                            }
                                                            {photo.treatment_records?.branches?.name && ` • ${photo.treatment_records.branches.name}`}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* TAB 3: KUPON PAKET */}
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
