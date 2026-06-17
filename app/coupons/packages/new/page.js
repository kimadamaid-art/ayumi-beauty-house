'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewCouponPackagePage() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [dbUser, setDbUser] = useState(null)
    const [treatments, setTreatments] = useState([])
    const [isLoading, setIsLoading] = useState(false)

    const [formData, setFormData] = useState({
        name: '',
        category: '',
        description: '',
        price: '',
        is_active: true
    })

    const [items, setItems] = useState([
        { treatment_id: '', quantity: 1 }
    ])

    async function fetchInitialData() {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const { data } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
            if (data) setDbUser(data)
        }

        const { data: trs } = await supabase.from('treatments').select('id, name, price').eq('is_active', true).order('name')
        if (trs) setTreatments(trs)
    }

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchInitialData()
    }, [])

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

    const removeItem = (index) => {
        const newItems = [...items]
        newItems.splice(index, 1)
        setItems(newItems)
    }

    const handleSave = async (e) => {
        e.preventDefault()
        
        // Validate items
        const validItems = items.filter(item => item.treatment_id && item.quantity > 0)
        if (validItems.length === 0) {
            alert('Minimal harus ada 1 treatment dalam paket dengan jumlah sesi > 0.')
            return
        }

        setIsLoading(true)

        try {
            // 1. Insert Package
            const { data: pkgData, error: pkgError } = await supabase
                .from('coupon_packages')
                .insert([{
                    name: formData.name,
                    category: formData.category,
                    description: formData.description,
                    price: Number(formData.price) || 0,
                    is_active: formData.is_active,
                    created_by: dbUser?.id
                }])
                .select()
                .single()

            if (pkgError) throw pkgError

            // 2. Insert Items
            const itemsToInsert = validItems.map((item, idx) => ({
                package_id: pkgData.id,
                treatment_id: item.treatment_id,
                quantity: Number(item.quantity),
                price_per_item: 0, // default logic: price is bundle price, individual items are 0
                sort_order: idx
            }))

            const { error: itemsError } = await supabase.from('coupon_package_items').insert(itemsToInsert)
            if (itemsError) throw itemsError

            alert('Paket Kupon berhasil dibuat!')
            router.push('/coupons')

        } catch (error) {
            alert('Gagal menyimpan paket: ' + error.message)
            setIsLoading(false)
        }
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
                    <h1 className="text-2xl font-bold text-gray-800">Tambah Paket Kupon</h1>
                    <p className="text-sm text-gray-500">Buat bundel treatment baru yang bisa dibeli oleh pasien.</p>
                </div>
            </div>

            <form onSubmit={handleSave} className="flex flex-col lg:flex-row gap-6">
                
                {/* Left Pane: Detail Paket */}
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
                                    placeholder="Contoh: Paket Glowing 5x"
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
                                    placeholder="Contoh: VIP, Reguler, Acne"
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
                                    placeholder="0"
                                />
                            </div>

                            <div className="md:col-span-2">
                                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Deskripsi Singkat (Opsional)</label>
                                <textarea
                                    name="description"
                                    value={formData.description}
                                    onChange={handleChange}
                                    className="input-ayumi bg-white w-full h-20 resize-none"
                                    placeholder="Jelaskan manfaat atau syarat paket ini..."
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
                                <span className="text-xs text-gray-500">(Bisa dibeli di Kasir)</span>
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
                                Tambah Treatment
                            </button>
                        </div>

                        {items.map((item, idx) => (
                            <div key={idx} className="flex flex-col sm:flex-row gap-3 items-end bg-gray-50 p-4 rounded-xl border border-gray-100 relative group">
                                {items.length > 1 && (
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
                                        className="input-ayumi bg-white w-full"
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

                {/* Right Pane: Summary & Submit */}
                <div className="w-full lg:w-1/3">
                    <div className="card-ayumi sticky top-6">
                        <div className="p-6 bg-gradient-to-br from-ayumi-secondary to-ayumi-primary text-white">
                            <h3 className="font-bold mb-1 opacity-90">Preview Paket</h3>
                            <p className="text-2xl font-extrabold leading-tight">{formData.name || 'Nama Paket...'}</p>
                            {formData.category && (
                                <span className="inline-block mt-2 text-[10px] font-bold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded">
                                    {formData.category}
                                </span>
                            )}
                        </div>
                        
                        <div className="p-6 space-y-4 border-b border-gray-100">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-500 font-semibold">Total Sesi Perawatan</span>
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
                                disabled={isLoading}
                                className="w-full btn-primary py-3.5 text-lg shadow-xl shadow-pink-500/30"
                            >
                                {isLoading ? 'Menyimpan...' : 'Simpan Paket Kupon'}
                            </button>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    )
}
