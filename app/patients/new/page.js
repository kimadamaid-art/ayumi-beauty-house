'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { toast } from 'react-hot-toast'

export default function AddPatientPage() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState('')

    const [formData, setFormData] = useState({
        branch_id: '',
        full_name: '',
        whatsapp: '',
        birth_date: '',
        gender: 'female',
        address: '',
        instagram: '',
        skin_type: 'normal',
        skin_concerns: '',
        allergies: '',
        medical_notes: ''
    })

    const [branches, setBranches] = useState([])

    useEffect(() => {
        const fetchBranches = async () => {
            const { data } = await supabase.from('branches').select('id, name')
            if (data && data.length > 0) {
                setBranches(data)
                setFormData(prev => ({ ...prev, branch_id: data[0].id }))
            }
        }
        fetchBranches()
    }, [supabase])

    const handleChange = (e) => {
        const { name, value } = e.target
        setFormData(prev => ({ ...prev, [name]: value }))
    }

    const handleSave = async (e) => {
        e.preventDefault()
        setError('')
        setIsSaving(true)

        // 1. Validasi WhatsApp Unik
        const { data: existingPatient } = await supabase
            .from('patients')
            .select('id')
            .eq('whatsapp', formData.whatsapp)
            .maybeSingle()

        if (existingPatient) {
            setError('Nomor WhatsApp ini sudah terdaftar sebagai pasien')
            toast.error('Nomor WhatsApp ini sudah terdaftar sebagai pasien')
            setIsSaving(false)
            return
        }

        // 1.5 Validasi Nama Duplikat (Warning)
        const { data: existingNames } = await supabase
            .from('patients')
            .select('id, whatsapp')
            .ilike('full_name', formData.full_name.trim())
            .limit(1)

        if (existingNames && existingNames.length > 0) {
            const proceed = window.confirm(`PERINGATAN: Pasien dengan nama "${formData.full_name}" sudah terdaftar (WA: ${existingNames[0].whatsapp || '-'}).\n\nYakin ingin mendaftarkan sebagai pasien baru? (Klik OK jika memang orang yang berbeda)`)
            if (!proceed) {
                setIsSaving(false)
                return
            }
        }

        // 2. Insert Data
        const { data: { user } } = await supabase.auth.getUser()

        // Sanitasi birth_date (jika diisi strip "-" atau tidak valid, jadikan null)
        let finalBirthDate = formData.birth_date
        if (!finalBirthDate || finalBirthDate === '-' || finalBirthDate.trim() === '') {
            finalBirthDate = null
        }

        const payload = {
            branch_id: formData.branch_id,
            full_name: formData.full_name,
            whatsapp: formData.whatsapp,
            birth_date: finalBirthDate,
            gender: formData.gender,
            address: formData.address,
            instagram: formData.instagram,
            skin_type: formData.skin_type,
            skin_concerns: formData.skin_concerns ? [formData.skin_concerns] : [], // Ini akan tersimpan sbg array (TEXT[]) di Postgres
            allergies: formData.allergies,
            medical_notes: formData.medical_notes
        }

        const { error: insertError } = await supabase
            .from('patients')
            .insert([payload])

        if (insertError) {
            let msg = insertError.message
            if (msg.includes('unique constraint') || msg.includes('23505')) {
                msg = 'Nomor WhatsApp ini sudah terdaftar sebagai pasien'
            }
            setError(msg)
            toast.error(msg)
            console.error(insertError)
        } else {
            toast.success('Pasien berhasil ditambahkan!')
            router.push('/patients')
            router.refresh()
        }

        setIsSaving(false)
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center gap-4 mb-4">
                <Link href="/patients">
                    <button className="text-ayumi-secondary hover:text-ayumi-primary bg-white p-2.5 rounded-full shadow-sm transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </button>
                </Link>
                <div>
                    <p className="text-sm text-ayumi-text-muted mt-1">Lengkapi data profil dan rekam medis awal pasien.</p>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 px-6 py-4 rounded-2xl flex items-center gap-3">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span className="font-medium text-sm">{error}</span>
                </div>
            )}

            <form onSubmit={handleSave} className="card-ayumi p-5 md:p-8 space-y-8">
                
                {/* 2 Columns Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                    
                    {/* Column 1: Info Pribadi */}
                    <div className="space-y-6">
                        <h3 className="text-lg font-bold text-ayumi-primary border-b border-pink-50 pb-3 flex items-center gap-2">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                            Informasi Pribadi
                        </h3>
                        
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Nama Lengkap *</label>
                            <input
                                type="text"
                                name="full_name"
                                value={formData.full_name}
                                onChange={handleChange}
                                required
                                className="input-ayumi bg-gray-50 focus:bg-white"
                                placeholder="Cth: Ayumi Lee"
                            />
                        </div>

                        <div className="space-y-5">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Cabang Klinik *</label>
                                <select
                                    name="branch_id"
                                    value={formData.branch_id}
                                    onChange={handleChange}
                                    required
                                    className="input-ayumi bg-gray-50 focus:bg-white appearance-none"
                                >
                                    <option value="" disabled>-- Pilih Cabang --</option>
                                    {branches.map(b => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Nomor WhatsApp *</label>
                                <input
                                    type="text"
                                    name="whatsapp"
                                    value={formData.whatsapp}
                                    onChange={handleChange}
                                    required
                                    className="input-ayumi bg-gray-50 focus:bg-white"
                                    placeholder="08123..."
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Instagram</label>
                                <input
                                    type="text"
                                    name="instagram"
                                    value={formData.instagram}
                                    onChange={handleChange}
                                    className="input-ayumi bg-gray-50 focus:bg-white"
                                    placeholder="@username"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Tanggal Lahir</label>
                                <input
                                    type="date"
                                    name="birth_date"
                                    value={formData.birth_date}
                                    onChange={handleChange}
                                    className="input-ayumi bg-gray-50 focus:bg-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Gender</label>
                                <select
                                    name="gender"
                                    value={formData.gender}
                                    onChange={handleChange}
                                    className="input-ayumi bg-gray-50 focus:bg-white"
                                >
                                    <option value="female">Wanita</option>
                                    <option value="male">Pria</option>
                                    <option value="other">Lainnya</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Alamat Lengkap</label>
                            <textarea
                                name="address"
                                value={formData.address}
                                onChange={handleChange}
                                rows="3"
                                className="input-ayumi bg-gray-50 focus:bg-white resize-none"
                                placeholder="Jalan..."
                            ></textarea>
                        </div>
                    </div>

                    {/* Column 2: Info Medis */}
                    <div className="space-y-6">
                        <h3 className="text-lg font-bold text-ayumi-primary border-b border-pink-50 pb-3 flex items-center gap-2">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                            Informasi Medis & Kulit
                        </h3>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Tipe Kulit Dasar</label>
                            <select
                                name="skin_type"
                                value={formData.skin_type}
                                onChange={handleChange}
                                className="input-ayumi bg-gray-50 focus:bg-white"
                            >
                                <option value="normal">Normal</option>
                                <option value="oily">Berminyak (Oily)</option>
                                <option value="dry">Kering (Dry)</option>
                                <option value="combination">Kombinasi</option>
                                <option value="sensitive">Sensitif</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Keluhan / Catatan Kulit</label>
                            <textarea
                                name="skin_concerns"
                                value={formData.skin_concerns}
                                onChange={handleChange}
                                rows="3"
                                className="input-ayumi bg-gray-50 focus:bg-white resize-none"
                                placeholder="Tulis keluhan atau kondisi kulit pasien di sini..."
                            ></textarea>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Riwayat Alergi</label>
                            <input
                                type="text"
                                name="allergies"
                                value={formData.allergies}
                                onChange={handleChange}
                                className="input-ayumi focus:border-red-400 focus:bg-red-50 text-red-700 placeholder-gray-400"
                                placeholder="Cth: Alergi udang, lidocaine (Kosongkan jika tidak ada)"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Catatan Medis Tambahan</label>
                            <textarea
                                name="medical_notes"
                                value={formData.medical_notes}
                                onChange={handleChange}
                                rows="3"
                                className="input-ayumi bg-gray-50 focus:bg-white resize-none"
                                placeholder="Riwayat penyakit, pengobatan, dll..."
                            ></textarea>
                        </div>
                    </div>
                </div>

                {/* Footer Action */}
                <div className="border-t border-gray-100 pt-8 flex justify-end gap-4 mt-8">
                    <Link href="/patients">
                        <button
                            type="button"
                            className="px-8 py-3.5 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                        >
                            Batal
                        </button>
                    </Link>
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="btn-primary px-8 py-3.5 text-sm flex items-center gap-2"
                    >
                        {isSaving ? 'Menyimpan...' : 'Simpan Data Pasien'}
                    </button>
                </div>
            </form>
        </div>
    )
}
