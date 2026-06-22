'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { toast } from 'react-hot-toast'

export default function NewLeadPage() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const SOURCES = ['instagram', 'tiktok', 'facebook', 'google', 'referral', 'walk_in', 'whatsapp', 'other']

    const [formData, setFormData] = useState({
        full_name: '',
        whatsapp: '',
        instagram: '',
        source: 'whatsapp',
        source_detail: '',
        interest_notes: '',
        status: 'new',
        branch_id: ''
    })
    const [branches, setBranches] = useState([])
    const [isOwner, setIsOwner] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        const fetchUserAndBranches = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
                
                if (userData?.role === 'owner') {
                    setIsOwner(true)
                    const { data: bData } = await supabase.from('branches').select('id, name').eq('is_active', true)
                    if (bData && bData.length > 0) {
                        setBranches(bData)
                        setFormData(prev => ({ ...prev, branch_id: bData[0].id }))
                    }
                } else {
                    // Therapist / Staff / Admin, auto-assign their branch
                    setIsOwner(false)
                    setFormData(prev => ({ ...prev, branch_id: userData?.branch_id || null }))
                }
            }
        }
        fetchUserAndBranches()
    }, [supabase])

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value })
    }

    const handleSave = async (e) => {
        e.preventDefault()
        setIsSaving(true)
        setError('')

        try {
            const { data, error: dbError } = await supabase
                .from('leads')
                .insert([formData])
                .select()
                .single()

            if (dbError) {
                let msg = dbError.message
                if (msg.includes('unique constraint') || msg.includes('23505')) {
                    msg = 'Nomor WhatsApp ini sudah terdaftar'
                }
                throw new Error(msg)
            }

            toast.success('Lead berhasil ditambahkan!')
            router.push(`/leads/${data.id}`)
            router.refresh()
        } catch (err) {
            setError(err.message)
            toast.error(err.message)
            setIsSaving(false)
        }
    }

    return (
        <div className="max-w-2xl mx-auto">
            <div className="card-ayumi p-8">
                
                {error && (
                    <div className="bg-red-50 text-red-600 p-4 rounded-xl mb-6 font-medium border border-red-100">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSave} className="space-y-5">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Nama Lengkap *</label>
                        <input
                            type="text"
                            name="full_name"
                            required
                            value={formData.full_name}
                            onChange={handleChange}
                            className="input-ayumi"
                            placeholder="John Doe"
                        />
                    </div>

                    {isOwner && (
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Cabang *</label>
                            <select
                                name="branch_id"
                                required
                                value={formData.branch_id}
                                onChange={handleChange}
                                className="input-ayumi"
                            >
                                <option value="" disabled>-- Pilih Cabang --</option>
                                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Nomor WhatsApp *</label>
                            <input
                                type="text"
                                name="whatsapp"
                                required
                                value={formData.whatsapp}
                                onChange={handleChange}
                                className="input-ayumi"
                                placeholder="08123456789"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Username Instagram</label>
                            <input
                                type="text"
                                name="instagram"
                                value={formData.instagram}
                                onChange={handleChange}
                                className="input-ayumi"
                                placeholder="@username"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Sumber (Source) *</label>
                            <select
                                name="source"
                                required
                                value={formData.source}
                                onChange={handleChange}
                                className="input-ayumi"
                            >
                                {SOURCES.map(s => <option key={s} value={s}>{s.replace('_', ' ').toUpperCase()}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Detail Sumber</label>
                            <input
                                type="text"
                                name="source_detail"
                                value={formData.source_detail}
                                onChange={handleChange}
                                className="input-ayumi"
                                placeholder="Misal: Iklan FB Promo Jan, Teman Budi"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Catatan Ketertarikan</label>
                        <textarea
                            name="interest_notes"
                            value={formData.interest_notes}
                            onChange={handleChange}
                            rows="3"
                            className="input-ayumi resize-none"
                            placeholder="Pasien tanya-tanya tentang treatment jerawat punggung..."
                        ></textarea>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={() => router.back()}
                            className="px-6 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors"
                        >
                            Batal
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="btn-primary px-8 py-3"
                        >
                            {isSaving ? 'Menyimpan...' : 'Simpan Lead'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
