'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

export default function EditCouponPackagePage() {
    const { id } = useParams()
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [treatments, setTreatments] = useState([])
    const [stats, setStats] = useState({ purchased: 0, fullyUsed: 0 })

    const [formData, setFormData] = useState({
        name: '',
        category: '',
        description: '',
        price: '',
        is_active: true
    })

    const [items, setItems] = useState([])

    async function fetchInitialData() {
        setIsLoading(true)

        // 1. Fetch Treatments
        const { data: trs } = await supabase.from('treatments').select('id, name, price').order('name')
        if (trs) setTreatments(trs)

        // 2. Fetch Package
        const { data: pkg, error } = await supabase
            .from('coupon_packages')
            .select(`
                *,
                coupon_package_items (
                    id, treatment_id, quantity, sort_order
                )
            `)
            .eq('id', id)
            .single()

        if (error || !pkg) {
            alert('Paket tidak ditemukan!')
            router.push('/coupons')
            return
        }

        setFormData({
            name: pkg.name,
            category: pkg.category || '',
            description: pkg.description || '',
            price: pkg.price || '',
            is_active: pkg.is_active
        })

        // Sort items by sort_order
        const sortedItems = (pkg.coupon_package_items || []).sort((a, b) => a.sort_order - b.sort_order)
        setItems(sortedItems.map(item => ({
            id: item.id, // exist in db
            treatment_id: item.treatment_id,
            quantity: item.quantity
        })))

        // 3. Fetch Stats
        const { data: patientCoupons } = await supabase
            .from('patient_coupons')
            .select('status')
            .eq('package_id', id)

        if (patientCoupons) {
            setStats({
                purchased: patientCoupons.length,
                fullyUsed: patientCoupons.filter(pc => pc.status === 'fully_used').length
            })
        }

        setIsLoading(false)
    }

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (id) fetchInitialData()
    }, [id])

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }))
    }

    const handleItemChange = (index, field, value) => {
        const newItems = [...items]
        newItems[index][field] = value
        setItems(newItems)
    }

    const addItem = () => {
        setItems([...items, { treatment_id: '', quantity: 1 }])
    }

    const removeItem = async (index) => {
        const itemToRemove = items[index]
        // If it's an existing item, we might need to delete it from DB on save, 
        // but for simplicity we'll just track current items and delete missing ones on save.
        const newItems = [...items]
        newItems.splice(index, 1)
        setItems(newItems)
    }

    const handleSave = async (e) => {
        e.preventDefault()
        
        const validItems = items.filter(item => item.treatment_id && item.quantity > 0)
        if (validItems.length === 0) {
            alert('Minimal harus ada 1 treatment dalam paket dengan jumlah sesi > 0.')
            return
        }

        setIsSaving(true)

        try {
            // 1. Update Package
            const { error: pkgError } = await supabase
                .from('coupon_packages')
                .update({
                    name: formData.name,
                    category: formData.category,
                    description: formData.description,
                    price: Number(formData.price) || 0,
                    is_active: formData.is_active,
                    updated_at: new Date()
                })
                .eq('id', id)

            if (pkgError) throw pkgError

            // 2. Update Items (Delete all existing, then insert new ones - simplest approach to handle edits/deletes)
            // Note: In a production app with constraints on patient_coupon_items, deleting might violate FKs.
            // If patient_coupon_items references coupon_package_items with ON DELETE CASCADE, it's dangerous.
            // Wait, patient_coupon_items references coupon_package_items. If we delete, it cascades.
            // So we MUST NOT delete existing items if they are already sold, we should upsert.

            for (let i = 0; i < validItems.length; i++) {
                const item = validItems[i]
                if (item.id) {
                    // Update existing
                    await supabase
                        .from('coupon_package_items')
                        .update({
                            treatment_id: item.treatment_id,
                            quantity: Number(item.quantity),
                            sort_order: i
                        })
                        .eq('id', item.id)
                } else {
                    // Insert new
                    await supabase
                        .from('coupon_package_items')
                        .insert([{
                            package_id: id,
                            treatment_id: item.treatment_id,
                            quantity: Number(item.quantity),
                            price_per_item: 0,
                            sort_order: i
                        }])
                }
            }

            // Delete missing items? Skip for safety of existing patient coupons.

            alert('Perubahan berhasil disimpan!')
            router.push('/coupons')

        } catch (error) {
            alert('Gagal menyimpan perubahan: ' + error.message)
        } finally {
            setIsSaving(false)
        }
    }

    if (isLoading) {
        return <div className="p-8 text-center animate-pulse text-gray-500">Memuat detail paket...</div>
    }

    const totalSessions = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/coupons">
                    <button className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm hover:shadow-md transition-shadow text-gray-500 hover:text-ayumi-primary">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Edit Paket: {formData.name}</h1>
                    <p className="text-sm text-gray-500">Ubah informasi atau isi dari paket kupon.</p>
                </div>
            </div>

            <form onSubmit={handleSave} className="flex flex-col lg:flex-row gap-6">
                
                {/* Left Pane */}
                <div className="w-full lg:w-2/3 space-y-6">
                    <div className="card-ayumi p-6 space-y-5">
                        <h2 className="text-lg font-bold text-ayumi-primary border-b border-gray-100 pb-2">Informasi Paket</h2>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="md:col-span-2">
                                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Nama Paket <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    required
                                    className="input-ayumi bg-white w-full"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Kategori</label>
                                <input
                                    type="text"
                                    name="category"
                                    value={formData.category}
                                    onChange={handleChange}
                                    className="input-ayumi bg-white w-full"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Harga Total Paket (Rp) <span className="text-red-500">*</span></label>
                                 <input
                                     type="text"
                                     name="price"
                                     value={formData.price ? Number(formData.price).toLocaleString('id-ID') : ''}
                                     onChange={(e) => {
                                         const rawValue = e.target.value.replace(/\D/g, '')
                                         setFormData(prev => ({ ...prev, price: rawValue }))
                                     }}
                                     required
                                     className="input-ayumi bg-white w-full font-mono font-bold text-gray-800"
                                 />
                            </div>

                            <div className="md:col-span-2">
                                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Deskripsi Singkat</label>
                                <textarea
                                    name="description"
                                    value={formData.description}
                                    onChange={handleChange}
                                    className="input-ayumi bg-white w-full h-20 resize-none"
                                ></textarea>
                            </div>
                            
                            <div className="md:col-span-2 flex items-center gap-3 bg-gray-50 p-3 rounded-xl">
                                <label className="text-sm font-semibold text-gray-700">Status Paket Aktif</label>
                                <button 
                                    type="button"
                                    onClick={() => setFormData(prev => ({ ...prev, is_active: !prev.is_active }))}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_active ? 'bg-ayumi-primary' : 'bg-gray-300'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                                <span className="text-xs text-gray-500">(Nonaktifkan jika paket ini sudah tidak dijual lagi)</span>
                            </div>
                        </div>
                    </div>

                    <div className="card-ayumi p-6 space-y-4">
                        <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                            <h2 className="text-lg font-bold text-ayumi-primary">Isi Paket (Treatments)</h2>
                            <button 
                                type="button" 
                                onClick={addItem}
                                className="text-sm font-semibold text-ayumi-secondary hover:text-pink-700 flex items-center gap-1 bg-pink-50 px-3 py-1.5 rounded-lg"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                Tambah
                            </button>
                        </div>

                        {/* WARNING for edits */}
                        {stats.purchased > 0 && (
                            <div className="bg-orange-50 border border-orange-200 text-orange-800 text-xs p-3 rounded-lg mb-4 flex gap-2 items-start">
                                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                <p>Hati-hati saat mengubah isi paket yang sudah pernah dibeli pasien. Perubahan jumlah sesi bisa memengaruhi sisa kuota mereka. Disarankan untuk menonaktifkan paket ini dan membuat paket baru jika perubahannya signifikan.</p>
                            </div>
                        )}

                        {items.map((item, idx) => (
                            <div key={idx} className="flex flex-col sm:flex-row gap-3 items-end bg-gray-50 p-4 rounded-xl border border-gray-100 relative group">
                                {items.length > 1 && !item.id && ( // only allow removing newly added items
                                    <button 
                                        type="button" 
                                        onClick={() => removeItem(idx)}
                                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-100 text-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-500 hover:text-white"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                )}
                                
                                <div className="flex-1 w-full">
                                    <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Pilih Treatment</label>
                                    <select 
                                        value={item.treatment_id}
                                        onChange={(e) => handleItemChange(idx, 'treatment_id', e.target.value)}
                                        required
                                        disabled={!!item.id} // disable editing existing treatment type to prevent FK issues
                                        className={`input-ayumi bg-white w-full ${item.id ? 'opacity-70 cursor-not-allowed' : ''}`}
                                    >
                                        <option value="" disabled>-- Pilih Treatment --</option>
                                        {treatments.map(t => (
                                            <option key={t.id} value={t.id}>{t.name} (Rp {t.price?.toLocaleString()})</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="w-full sm:w-32">
                                    <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Jumlah Sesi</label>
                                    <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 p-1">
                                        <button 
                                            type="button"
                                            onClick={() => handleItemChange(idx, 'quantity', Math.max(1, item.quantity - 1))}
                                            className="w-8 h-8 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 flex items-center justify-center"
                                        >-</button>
                                        <input 
                                            type="number" 
                                            value={item.quantity}
                                            onChange={(e) => handleItemChange(idx, 'quantity', parseInt(e.target.value) || 1)}
                                            className="w-full text-center font-bold text-gray-800 bg-transparent border-none focus:ring-0 p-0"
                                            min="1"
                                        />
                                        <button 
                                            type="button"
                                            onClick={() => handleItemChange(idx, 'quantity', item.quantity + 1)}
                                            className="w-8 h-8 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 flex items-center justify-center"
                                        >+</button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Pane */}
                <div className="w-full lg:w-1/3">
                    <div className="card-ayumi sticky top-6">
                        <div className="p-6 bg-gradient-to-br from-ayumi-secondary to-ayumi-primary text-white">
                            <h3 className="font-bold mb-1 opacity-90">Statistik Paket</h3>
                            <div className="grid grid-cols-2 gap-4 mt-4">
                                <div className="bg-white/10 p-3 rounded-lg text-center">
                                    <p className="text-xs uppercase tracking-wider opacity-80 mb-1">Terjual</p>
                                    <p className="text-xl font-bold">{stats.purchased}x</p>
                                </div>
                                <div className="bg-white/10 p-3 rounded-lg text-center">
                                    <p className="text-xs uppercase tracking-wider opacity-80 mb-1">Selesai</p>
                                    <p className="text-xl font-bold">{stats.fullyUsed}x</p>
                                </div>
                            </div>
                        </div>
                        
                        <div className="p-6 space-y-4 border-b border-gray-100">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-500 font-semibold">Total Sesi</span>
                                <span className="text-xl font-black text-gray-800 font-mono">{totalSessions}</span>
                            </div>
                            
                            <div className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-100">
                                <span className="text-sm text-gray-500 font-semibold">Harga Jual</span>
                                <span className="text-xl font-black text-ayumi-primary font-mono">Rp {(Number(formData.price) || 0).toLocaleString('id-ID')}</span>
                            </div>
                        </div>

                        <div className="p-6 bg-pink-50/30">
                            <button
                                type="submit"
                                disabled={isSaving}
                                className="w-full btn-primary py-3.5 text-lg shadow-xl shadow-pink-500/30"
                            >
                                {isSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
                            </button>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    )
}
