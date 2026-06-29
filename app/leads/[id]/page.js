'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'

export default function LeadDetailPage({ params }) {
    const router = useRouter()
    const { id } = params
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [lead, setLead] = useState(null)
    const [loading, setLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState('')

    // Editable state
    const [status, setStatus] = useState('')
    const [lostReason, setLostReason] = useState('')
    const [notes, setNotes] = useState('')

    const STATUSES = ['new', 'contacted', 'interested', 'booked', 'converted', 'lost']

    useEffect(() => {
        fetchLead()
    }, [id])

    const fetchLead = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from('leads')
            .select('*')
            .eq('id', id)
            .single()

        if (data) {
            setLead(data)
            setStatus(data.status || 'new')
            setLostReason(data.lost_reason || '')
            setNotes(data.notes || '')
        }
        setLoading(false)
    }

    const handleUpdate = async () => {
        if (status === 'lost' && !lostReason.trim()) {
            setError('Alasan Gagal (Lost Reason) wajib diisi jika status diubah menjadi Lost.')
            return
        }

        setIsSaving(true)
        setError('')

        try {
            const { error: updateErr } = await supabase
                .from('leads')
                .update({
                    status,
                    lost_reason: status === 'lost' ? lostReason : null,
                    notes,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)

            if (updateErr) throw updateErr

            // Refresh data
            fetchLead()
            alert('Status Lead berhasil diperbarui!')
        } catch (err) {
            setError(err.message)
        } finally {
            setIsSaving(false)
        }
    }

    const getStatusColor = (s) => {
        switch (s) {
            case 'new': return 'bg-blue-100 text-blue-700'
            case 'contacted': return 'bg-yellow-100 text-yellow-700'
            case 'interested': return 'bg-orange-100 text-orange-700'
            case 'booked': return 'bg-purple-100 text-purple-700'
            case 'converted': return 'bg-green-100 text-green-700'
            case 'lost': return 'bg-red-100 text-red-700'
            default: return 'bg-gray-100 text-gray-700'
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center p-12">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
            </div>
        )
    }

    if (!lead) return <div className="p-5 md:p-8 text-center text-gray-500">Lead tidak ditemukan.</div>

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            
            {/* Header Profil */}
            <div className="card-ayumi p-5 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-pink-50 text-ayumi-primary rounded-2xl flex items-center justify-center font-bold text-2xl">
                        {lead.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-ayumi-secondary">{lead.full_name}</h2>
                        <div className="flex flex-wrap items-center gap-3 mt-2">
                            <span className="flex items-center gap-1 text-sm font-semibold text-gray-600 bg-gray-50 px-3 py-1 rounded-lg">
                                <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 6.46 17.5 2 12.04 2ZM17.16 16.36C16.94 17 16.08 17.5 15.42 17.58C14.93 17.64 14.23 17.74 11.75 16.71C8.57 15.39 6.5 12.14 6.34 11.92C6.18 11.71 5 10.15 5 8.53C5 6.91 5.84 6.13 6.16 5.8C6.43 5.53 6.87 5.4 7.27 5.4C7.4 5.4 7.52 5.4 7.63 5.41C7.94 5.43 8.1 5.45 8.3 5.92C8.55 6.52 9.16 8.01 9.24 8.17C9.32 8.33 9.4 8.55 9.29 8.76C9.18 8.98 9.07 9.1 8.92 9.28C8.77 9.46 8.61 9.61 8.48 9.77C8.32 9.94 8.14 10.12 8.33 10.45C8.52 10.77 9.15 11.8 10.08 12.63C11.27 13.69 12.24 14.03 12.59 14.18C12.94 14.33 13.31 14.31 13.54 14.07C13.82 13.78 14.18 13.25 14.54 12.72C14.83 12.28 15.22 12.23 15.63 12.38C16.04 12.53 18.23 13.61 18.63 13.81C19.04 14.01 19.31 14.1 19.42 14.3C19.52 14.5 19.52 15.44 19.16 16.36Z" /></svg>
                                {lead.whatsapp}
                            </span>
                            {lead.instagram && (
                                <span className="flex items-center gap-1 text-sm font-semibold text-gray-600 bg-gray-50 px-3 py-1 rounded-lg">
                                    <svg className="w-4 h-4 text-pink-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                                    {lead.instagram}
                                </span>
                            )}
                            <span className="text-sm font-semibold text-gray-500 bg-gray-100 px-3 py-1 rounded-lg uppercase tracking-wide">
                                {lead.source?.replace('_', ' ')}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3 w-full md:w-auto">
                    <a href={`https://wa.me/${lead.whatsapp}`} target="_blank" rel="noopener noreferrer" className="flex-1 md:flex-none">
                        <button className="w-full bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-md flex items-center justify-center gap-2">
                            Hubungi WA
                        </button>
                    </a>
                </div>
            </div>

            {/* Panel Update Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Kiri: Update Panel */}
                <div className="card-ayumi p-5 md:p-8">
                    <h3 className="text-lg font-bold text-ayumi-secondary border-b border-pink-50 pb-3 mb-6">Update Pipeline</h3>
                    
                    {error && (
                        <div className="bg-red-50 text-red-600 p-4 rounded-xl mb-6 font-medium border border-red-100 text-sm">
                            {error}
                        </div>
                    )}

                    <div className="space-y-5">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Status Saat Ini</label>
                            <div className="relative">
                                <select 
                                    value={status}
                                    onChange={(e) => setStatus(e.target.value)}
                                    className={`w-full appearance-none border-2 border-gray-100 rounded-xl px-4 py-3 text-sm font-bold uppercase tracking-wider outline-none transition-colors ${getStatusColor(status)} focus:ring-2 focus:ring-ayumi-primary`}
                                >
                                    {STATUSES.map(s => <option key={s} value={s} className="bg-white text-gray-800">{s}</option>)}
                                </select>
                            </div>
                        </div>

                        {status === 'lost' && (
                            <div className="animate-fade-in-up">
                                <label className="block text-sm font-semibold text-red-600 mb-2">Alasan Gagal (Lost Reason) *</label>
                                <select
                                    value={lostReason}
                                    onChange={(e) => setLostReason(e.target.value)}
                                    className="input-ayumi focus:border-red-400 focus:bg-red-50 text-red-700"
                                >
                                    <option value="">Pilih Alasan</option>
                                    <option value="kemahalan">Kemahalan / Budget Kurang</option>
                                    <option value="tidak_direspon">Tidak Merespon WA (Ghosting)</option>
                                    <option value="pindah_klinik">Pilih Klinik Lain</option>
                                    <option value="jarak_jauh">Jarak Terlalu Jauh</option>
                                    <option value="lainnya">Lainnya</option>
                                </select>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Catatan Internal CS</label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows="4"
                                className="input-ayumi resize-none"
                                placeholder="Tuliskan hasil percakapan terakhir dengan calon pasien..."
                            ></textarea>
                        </div>

                        <button
                            onClick={handleUpdate}
                            disabled={isSaving}
                            className="btn-primary w-full py-3.5"
                        >
                            {isSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
                        </button>
                    </div>
                </div>

                {/* Kanan: Info Tambahan */}
                <div className="card-ayumi p-5 md:p-8">
                    <h3 className="text-lg font-bold text-ayumi-secondary border-b border-pink-50 pb-3 mb-6">Detail Ketertarikan</h3>
                    
                    <div className="space-y-6">
                        <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Tanggal Masuk</p>
                            <p className="text-sm font-semibold text-gray-800">
                                {new Date(lead.created_at).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' })}
                            </p>
                        </div>
                        
                        <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Detail Sumber Info</p>
                            <p className="text-sm font-semibold text-gray-800 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                {lead.source_detail || <span className="text-gray-400 italic">Tidak ada detail</span>}
                            </p>
                        </div>

                        <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Catatan Ketertarikan Awal</p>
                            <p className="text-sm font-semibold text-gray-800 bg-gray-50 p-3 rounded-xl border border-gray-100 min-h-[100px] whitespace-pre-wrap">
                                {lead.interest_notes || <span className="text-gray-400 italic">Kosong</span>}
                            </p>
                        </div>

                        {status === 'converted' && (
                            <div className="bg-green-50 border border-green-100 rounded-xl p-4 flex flex-col items-center justify-center text-center">
                                <svg className="w-10 h-10 text-green-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                <p className="font-bold text-green-800">Lead Berhasil Dikonversi!</p>
                                <p className="text-xs text-green-600 mt-1">Jangan lupa mendaftarkan mereka di menu Data Pasien.</p>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    )
}
