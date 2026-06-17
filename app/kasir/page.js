'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'

export default function PosPage() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    // Auth & Branches
    const [dbUser, setDbUser] = useState(null)
    const [branches, setBranches] = useState([])
    const [selectedBranch, setSelectedBranch] = useState('')
    const [isLoading, setIsLoading] = useState(true)

    // Data
    const [treatments, setTreatments] = useState([])
    const [products, setProducts] = useState([])
    const [coupons, setCoupons] = useState([])
    const [patients, setPatients] = useState([])
    const [pendingBills, setPendingBills] = useState([])
    
    // UI State
    const [activeTab, setActiveTab] = useState('treatment') // 'treatment' | 'product' | 'coupon'
    const [searchQuery, setSearchQuery] = useState('')
    const [searchPatientQuery, setSearchPatientQuery] = useState('')
    const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false)
    const [isPendingModalOpen, setIsPendingModalOpen] = useState(false)

    // Cart State
    const [cart, setCart] = useState([]) // { id, item_type, name, price, quantity, maxQuantity (for products) }
    const [selectedPatient, setSelectedPatient] = useState(null)
    const [discountType, setDiscountType] = useState('nominal') // 'nominal' | 'percent'
    const [discountValue, setDiscountValue] = useState(0)
    const [paymentMethod, setPaymentMethod] = useState('cash')
    const [notes, setNotes] = useState('')
    const [isProcessing, setIsProcessing] = useState(false)

    async function fetchInitialData() {
        setIsLoading(true)
        
        // Fetch User
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const { data: uData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
            if (uData) {
                setDbUser(uData)
                if (uData.role !== 'owner') {
                    setSelectedBranch(uData.branch_id || '')
                }
            } else {
                setDbUser({ role: 'owner', id: user.id })
            }
        }
        
        // Fetch Branches
        const { data: brData } = await supabase.from('branches').select('id, name').eq('is_active', true)
        if (brData) setBranches(brData)
            
        // Fetch Treatments
        const { data: trData } = await supabase.from('treatments').select('*').eq('is_active', true).order('name', { ascending: true })
        if (trData) setTreatments(trData)
            
        // Fetch Coupons
        const { data: cpData } = await supabase.from('coupon_packages').select('*').eq('is_active', true).order('name', { ascending: true })
        if (cpData) setCoupons(cpData)

        // Fetch Patients (for search autocomplete)
        const { data: patData } = await supabase.from('patients').select('id, full_name, whatsapp').order('full_name', { ascending: true })
        if (patData) setPatients(patData)

        setIsLoading(false)
    }

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchInitialData()
    }, [supabase])

    async function fetchProducts() {
        // Fetch products that are active and have stock > 0 in selected branch
        const { data, error } = await supabase
            .from('product_stock')
            .select(`
                quantity,
                product_id,
                products (id, name, price, is_active)
            `)
            .eq('branch_id', selectedBranch)
            .gt('quantity', 0)
            
        if (data) {
            const availableProducts = data
                .filter(item => item.products && item.products.is_active)
                .map(item => ({
                    ...item.products,
                    quantity: item.quantity
                }))
                .sort((a, b) => a.name.localeCompare(b.name))
            setProducts(availableProducts)
        }
    }

    // When branch changes, fetch available products for that branch
    useEffect(() => {
        if (selectedBranch) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            fetchProducts()
            setCart(prev => prev.filter(item => item.item_type !== 'product')) // Clear products from cart if branch changes
        } else {
            setProducts([])
        }
    }, [selectedBranch])


    const fetchPendingBills = async () => {
        // Fetch all treatment_records that don't have a transaction
        // First, get treatment records of today
        const todayStr = new Date().toISOString().split('T')[0]
        const { data: trData } = await supabase
            .from('treatment_records')
            .select(`
                id, treatment_time, treatment_date,
                patients(id, full_name, whatsapp),
                treatment_record_items(treatment_id, price_at_time, treatments(name))
            `)
            .eq('treatment_date', todayStr)
            .order('treatment_time', { ascending: true })

        if (!trData) return

        // Fetch transactions today to cross-check
        const { data: txData } = await supabase
            .from('transactions')
            .select('treatment_record_id')
            .gte('created_at', todayStr + 'T00:00:00Z')

        const txRecordIds = txData?.map(t => t.treatment_record_id).filter(Boolean) || []

        const pending = trData.filter(tr => !txRecordIds.includes(tr.id))
        setPendingBills(pending)
    }

    const handleOpenPendingModal = () => {
        fetchPendingBills()
        setIsPendingModalOpen(true)
    }

    const loadPendingBillToCart = (bill) => {
        // Select patient
        setSelectedPatient(bill.patients)
        setSearchPatientQuery(bill.patients?.full_name || '')
        
        // Populate cart
        const newCart = bill.treatment_record_items.map(item => ({
            id: item.treatment_id, // For treatment
            item_type: 'treatment',
            name: item.treatments?.name || 'Treatment',
            price: item.price_at_time,
            quantity: 1, // Usually 1 per item in treatment_records
            subtotal: item.price_at_time,
            treatment_record_id: bill.id // Temporary flag to attach to transaction later
        }))

        setCart(newCart)
        setIsPendingModalOpen(false)
    }


    // --- Cart Actions ---
    const addToCart = (item, type) => {
        if (!selectedBranch) {
            alert('Silakan pilih cabang terlebih dahulu!')
            return
        }

        setCart(prev => {
            const existingItem = prev.find(i => i.id === item.id && i.item_type === type)
            if (existingItem) {
                // If product, check max stock
                if (type === 'product' && existingItem.quantity >= item.quantity) {
                    alert(`Stok tidak mencukupi! Sisa stok: ${item.quantity}`)
                    return prev
                }
                return prev.map(i => 
                    (i.id === item.id && i.item_type === type) 
                        ? { ...i, quantity: i.quantity + 1 } 
                        : i
                )
            } else {
                // Apply treatment discount if exists
                let price = item.price
                if (type === 'treatment' && item.discount_percent > 0) {
                    price = item.price * (1 - item.discount_percent / 100)
                }

                return [...prev, {
                    id: item.id,
                    item_type: type,
                    name: item.name,
                    price: price,
                    quantity: 1,
                    maxQuantity: type === 'product' ? item.quantity : null
                }]
            }
        })
    }

    const updateCartQty = (id, type, change) => {
        setCart(prev => {
            return prev.map(i => {
                if (i.id === id && i.item_type === type) {
                    const newQty = i.quantity + change
                    if (newQty < 1) return i // don't go below 1, use remove instead
                    if (i.item_type === 'product' && newQty > i.maxQuantity) {
                        alert(`Stok tidak mencukupi! Sisa stok: ${i.maxQuantity}`)
                        return i
                    }
                    return { ...i, quantity: newQty }
                }
                return i
            })
        })
    }

    const removeFromCart = (id, type) => {
        setCart(prev => prev.filter(i => !(i.id === id && i.item_type === type)))
    }

    // --- Totals ---
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    let discountAmount = 0
    if (discountType === 'nominal') {
        discountAmount = Number(discountValue) || 0
    } else {
        discountAmount = subtotal * ((Number(discountValue) || 0) / 100)
    }
    const total = Math.max(0, subtotal - discountAmount)

    // --- Checkout ---
    const handleCheckout = async () => {
        if (cart.length === 0) {
            alert('Keranjang belanja kosong!')
            return
        }
        if (!selectedBranch) {
            alert('Pilih cabang terlebih dahulu!')
            return
        }

        const hasCoupon = cart.some(item => item.item_type === 'coupon')
        if (hasCoupon && !selectedPatient) {
            alert('Pelanggan wajib dipilih jika Anda menjual Kupon Paket!')
            return
        }

        setIsProcessing(true)

        try {
            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
            // eslint-disable-next-line react-hooks/purity
            const randomCode = Math.floor(1000 + Math.random() * 9000)
            const trxNumber = `TRX-${dateStr}-${randomCode}`

            // Extract treatment_record_id if we loaded from pending bills
            const treatmentRecordId = cart.find(i => i.treatment_record_id)?.treatment_record_id || null

            // 3. Insert Transaction
            const { data: trxData, error: trxError } = await supabase
                .from('transactions')
                .insert([{
                    transaction_number: trxNumber,
                    patient_id: selectedPatient?.id || null,
                    branch_id: selectedBranch,
                    treatment_record_id: treatmentRecordId,
                    cashier_id: dbUser?.id,
                    subtotal: subtotal,
                    discount: Number(discountValue) || 0,
                    discount_type: discountType,
                    total: total,
                    payment_method: paymentMethod,
                    payment_status: 'paid', // Defaulting to paid for simplicity in POS
                    notes: notes,
                    created_by: dbUser?.id
                }])
                .select()
                .single()

            if (trxError) throw trxError

            // 4. Insert Transaction Items
            const itemsToInsert = cart.map(item => ({
                transaction_id: trxData.id,
                item_type: item.item_type,
                treatment_id: item.item_type === 'treatment' ? item.id : null,
                product_id: item.item_type === 'product' ? item.id : null,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                subtotal: item.price * item.quantity
            }))

            const { error: itemsError } = await supabase.from('transaction_items').insert(itemsToInsert)
            if (itemsError) throw itemsError

            // 5. Update Product Stocks & Insert Patient Coupons
            for (const item of cart) {
                if (item.item_type === 'product') {
                    // Decrease stock
                    const { data: stockData } = await supabase
                        .from('product_stock')
                        .select('id, quantity')
                        .eq('product_id', item.id)
                        .eq('branch_id', selectedBranch)
                        .single()
                        
                    if (stockData) {
                        await supabase
                            .from('product_stock')
                            .update({ quantity: Math.max(0, stockData.quantity - item.quantity) })
                            .eq('id', stockData.id)
                    }
                } else if (item.item_type === 'coupon') {
                    // For each coupon quantity, generate patient_coupons
                    for (let i = 0; i < item.quantity; i++) {
                        // Expire 1 year from now
                        const expiryDate = new Date()
                        expiryDate.setFullYear(expiryDate.getFullYear() + 1)

                        const { data: pCoupon, error: pCouponError } = await supabase.from('patient_coupons').insert([{
                            patient_id: selectedPatient.id,
                            package_id: item.id,
                            transaction_id: trxData.id,
                            expired_at: expiryDate.toISOString(),
                            status: 'active',
                            created_by: dbUser?.id
                        }]).select().single()

                        if (pCouponError) throw pCouponError

                        // Fetch package items
                        const { data: pkgItems } = await supabase
                            .from('coupon_package_items')
                            .select('*')
                            .eq('package_id', item.id)

                        if (pkgItems && pkgItems.length > 0) {
                            const pCouponItems = pkgItems.map(pi => ({
                                patient_coupon_id: pCoupon.id,
                                coupon_package_item_id: pi.id,
                                treatment_id: pi.treatment_id,
                                total_sessions: pi.quantity,
                                remaining_sessions: pi.quantity,
                                used_sessions: 0,
                                status: 'active'
                            }))
                            await supabase.from('patient_coupon_items').insert(pCouponItems)
                        }
                    }
                }
            }

            // 6. Navigate to Receipt page
            router.push(`/kasir/transactions/${trxData.id}`)
            
        } catch (error) {
            console.error(error)
            alert('Terjadi kesalahan saat memproses pembayaran: ' + error.message)
            setIsProcessing(false)
        }
    }

    const filteredPatients = patients.filter(p => 
        (p.full_name && p.full_name.toLowerCase().includes(searchPatientQuery.toLowerCase())) || 
        (p.whatsapp && p.whatsapp.includes(searchPatientQuery))
    ).slice(0, 5)

    if (isLoading) {
        return <div className="p-8 text-center animate-pulse text-ayumi-text-muted">Memuat antarmuka kasir...</div>
    }

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-100px)]">
            
            {/* LEFT PANE: ITEMS LIST */}
            <div className="w-full lg:w-2/3 flex flex-col bg-white rounded-3xl shadow-sm border border-pink-100/50 overflow-hidden">
                {/* Header / Branch Selector */}
                <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-3 bg-pink-50/30">
                    <div className="flex bg-gray-100 p-1 rounded-xl w-full sm:w-auto overflow-x-auto hide-scrollbar">
                        <button 
                            onClick={() => setActiveTab('treatment')}
                            className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'treatment' ? 'bg-white shadow text-ayumi-primary' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Treatment
                        </button>
                        <button 
                            onClick={() => setActiveTab('product')}
                            className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'product' ? 'bg-white shadow text-orange-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Produk Fisik
                        </button>
                        <button 
                            onClick={() => setActiveTab('coupon')}
                            className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'coupon' ? 'bg-white shadow text-pink-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Kupon Paket
                        </button>
                    </div>
                    
                    {dbUser?.role === 'owner' ? (
                        <select 
                            value={selectedBranch}
                            onChange={(e) => setSelectedBranch(e.target.value)}
                            className="bg-white border border-pink-200 text-ayumi-primary text-sm rounded-lg focus:ring-ayumi-primary focus:border-ayumi-primary block p-2 font-bold outline-none"
                        >
                            <option value="" disabled>-- Pilih Cabang --</option>
                            {branches.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                    ) : (
                        <div className="text-sm font-bold text-ayumi-primary bg-pink-50 px-4 py-2 rounded-lg border border-pink-100">
                            {branches.find(b => b.id === selectedBranch)?.name || 'Cabang'}
                        </div>
                    )}
                    
                    <button 
                        onClick={handleOpenPendingModal}
                        className="bg-orange-100 hover:bg-orange-200 text-orange-600 px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 whitespace-nowrap"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Tagihan Tertunda
                    </button>
                </div>

                {/* Search */}
                <div className="p-4 border-b border-gray-100">
                    <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        </span>
                        <input
                            type="text"
                            placeholder={`Cari ${activeTab === 'treatment' ? 'treatment' : activeTab === 'product' ? 'produk' : 'paket kupon'}...`}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input-ayumi pl-10 bg-gray-50 w-full rounded-xl"
                        />
                    </div>
                </div>

                {/* Items Grid */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-gray-50/50">
                    {!selectedBranch && activeTab === 'product' ? (
                        <div className="text-center text-gray-500 mt-10">Pilih cabang terlebih dahulu untuk melihat stok produk.</div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {activeTab === 'treatment' && treatments
                                .filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                .map(t => {
                                    const hasDiscount = t.discount_percent > 0
                                    const price = hasDiscount ? t.price * (1 - t.discount_percent / 100) : t.price
                                    return (
                                        <div 
                                            key={t.id} 
                                            onClick={() => addToCart(t, 'treatment')}
                                            className="bg-white p-4 rounded-2xl border border-purple-100 shadow-sm hover:shadow-md hover:border-purple-300 transition-all cursor-pointer group flex flex-col justify-between h-32"
                                        >
                                            <h4 className="font-bold text-gray-800 line-clamp-2 leading-snug group-hover:text-purple-700">{t.name}</h4>
                                            <div>
                                                {hasDiscount && <span className="text-[10px] line-through text-gray-400 block">Rp {t.price.toLocaleString('id-ID')}</span>}
                                                <span className="font-mono font-bold text-ayumi-primary">Rp {price.toLocaleString('id-ID')}</span>
                                            </div>
                                        </div>
                                    )
                                })
                            }

                            {activeTab === 'product' && products
                                .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                .map(p => (
                                    <div 
                                        key={p.id} 
                                        onClick={() => addToCart(p, 'product')}
                                        className="bg-white p-4 rounded-2xl border border-orange-100 shadow-sm hover:shadow-md hover:border-orange-300 transition-all cursor-pointer group flex flex-col justify-between h-32 relative overflow-hidden"
                                    >
                                        <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-[10px] font-bold px-2 py-1 rounded-bl-xl">
                                            Stok: {p.quantity}
                                        </div>
                                        <h4 className="font-bold text-gray-800 line-clamp-2 leading-snug group-hover:text-orange-600 pr-8">{p.name}</h4>
                                        <span className="font-mono font-bold text-orange-600">Rp {p.price.toLocaleString('id-ID')}</span>
                                    </div>
                                ))
                            }

                            {activeTab === 'coupon' && coupons
                                .filter(c => !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                .map(c => (
                                    <div 
                                        key={c.id} 
                                        onClick={() => addToCart(c, 'coupon')}
                                        className="bg-white p-4 rounded-2xl border border-pink-200 shadow-sm hover:shadow-md hover:border-pink-400 transition-all cursor-pointer group flex flex-col justify-between h-32 relative overflow-hidden"
                                    >
                                        {c.category && (
                                            <div className="absolute top-0 right-0 bg-pink-100 text-pink-700 text-[10px] font-bold px-2 py-1 rounded-bl-xl uppercase">
                                                {c.category}
                                            </div>
                                        )}
                                        <h4 className="font-bold text-gray-800 line-clamp-2 leading-snug group-hover:text-pink-600 pr-8">{c.name}</h4>
                                        <span className="font-mono font-bold text-pink-600">Rp {c.price.toLocaleString('id-ID')}</span>
                                    </div>
                                ))
                            }
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT PANE: CART & CHECKOUT */}
            <div className="w-full lg:w-1/3 flex flex-col bg-white rounded-3xl shadow-lg border border-gray-100 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-ayumi-secondary to-ayumi-primary"></div>
                
                {/* Patient Selector */}
                <div className="p-5 border-b border-gray-100 pt-6">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Pelanggan (Opsional)</label>
                    {selectedPatient ? (
                        <div className="flex justify-between items-center bg-blue-50 p-3 rounded-xl border border-blue-100">
                            <div>
                                <p className="font-bold text-blue-900 leading-tight">{selectedPatient.full_name}</p>
                                <p className="text-xs text-blue-700 mt-0.5">{selectedPatient.whatsapp || 'No HP Tidak ada'}</p>
                            </div>
                            <button onClick={() => setSelectedPatient(null)} className="text-blue-400 hover:text-blue-600 p-1 bg-white rounded-full">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    ) : (
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Cari Pasien (Nama/WA)..."
                                value={searchPatientQuery}
                                onChange={(e) => {
                                    setSearchPatientQuery(e.target.value)
                                    setIsPatientDropdownOpen(true)
                                }}
                                onFocus={() => setIsPatientDropdownOpen(true)}
                                className="input-ayumi w-full bg-gray-50"
                            />
                            {isPatientDropdownOpen && searchPatientQuery && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100 shadow-xl rounded-xl max-h-60 overflow-y-auto">
                                    {filteredPatients.length > 0 ? (
                                        filteredPatients.map(p => (
                                            <div 
                                                key={p.id} 
                                                onClick={() => {
                                                    setSelectedPatient(p)
                                                    setSearchPatientQuery('')
                                                    setIsPatientDropdownOpen(false)
                                                }}
                                                className="px-4 py-3 hover:bg-ayumi-table-hover cursor-pointer border-b border-gray-50 last:border-0"
                                            >
                                                <p className="font-bold text-gray-800">{p.full_name}</p>
                                                <p className="text-xs text-gray-500">{p.whatsapp}</p>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="px-4 py-3 text-sm text-gray-500">Pasien tidak ditemukan.</div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-5 custom-scrollbar bg-gray-50/30">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3">
                            <svg className="w-16 h-16 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                            <p className="text-sm font-semibold">Keranjang Masih Kosong</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {cart.map((item, idx) => (
                                <div key={idx} className="flex gap-3 bg-white p-3 rounded-xl border border-gray-100 shadow-sm relative pr-10">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${item.item_type === 'treatment' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'}`}>
                                                {item.item_type}
                                            </span>
                                        </div>
                                        <p className="font-bold text-gray-800 text-sm leading-tight mb-2">{item.name}</p>
                                        <p className="font-mono font-semibold text-ayumi-primary text-sm">Rp {item.price.toLocaleString('id-ID')}</p>
                                    </div>
                                    <div className="flex flex-col items-center justify-center">
                                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-1 border border-gray-200">
                                            <button onClick={() => updateCartQty(item.id, item.item_type, -1)} className="w-6 h-6 flex items-center justify-center text-gray-600 bg-white rounded shadow-sm hover:bg-gray-100">-</button>
                                            <span className="font-bold text-sm w-4 text-center">{item.quantity}</span>
                                            <button onClick={() => updateCartQty(item.id, item.item_type, 1)} className="w-6 h-6 flex items-center justify-center text-gray-600 bg-white rounded shadow-sm hover:bg-gray-100">+</button>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => removeFromCart(item.id, item.item_type)}
                                        className="absolute top-3 right-3 text-gray-400 hover:text-red-500 transition-colors"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Totals & Payment */}
                <div className="border-t border-gray-100 bg-white p-5 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)] z-10">
                    <div className="space-y-3 mb-5">
                        <div className="flex justify-between text-sm text-gray-600">
                            <span>Subtotal</span>
                            <span className="font-mono font-bold">Rp {subtotal.toLocaleString('id-ID')}</span>
                        </div>
                        
                        <div className="flex items-center justify-between gap-4">
                            <span className="text-sm text-gray-600 w-20">Diskon</span>
                            <div className="flex flex-1 gap-2">
                                <select 
                                    value={discountType} 
                                    onChange={(e) => setDiscountType(e.target.value)}
                                    className="input-ayumi bg-gray-50 py-1 px-2 text-xs w-24"
                                >
                                    <option value="nominal">Rp</option>
                                    <option value="percent">%</option>
                                </select>
                                <input 
                                    type="number"
                                    value={discountValue}
                                    onChange={(e) => setDiscountValue(e.target.value)}
                                    className="input-ayumi py-1 px-3 text-right flex-1 bg-gray-50 font-mono"
                                    min="0"
                                />
                            </div>
                        </div>

                        {discountAmount > 0 && (
                            <div className="flex justify-between text-sm text-red-500 font-semibold">
                                <span>Potongan</span>
                                <span className="font-mono">- Rp {discountAmount.toLocaleString('id-ID')}</span>
                            </div>
                        )}

                        <div className="flex justify-between text-lg border-t border-gray-100 pt-3">
                            <span className="font-bold text-gray-800">TOTAL BAYAR</span>
                            <span className="font-extrabold text-2xl text-ayumi-secondary font-mono">Rp {total.toLocaleString('id-ID')}</span>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <select 
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value)}
                            className="input-ayumi w-full bg-blue-50/50 border-blue-200 font-bold text-blue-900 py-3"
                        >
                            <option value="cash">💵 Uang Tunai (Cash)</option>
                            <option value="transfer">🏦 Transfer Bank</option>
                            <option value="qris">📱 QRIS</option>
                            <option value="debit">💳 Kartu Debit</option>
                            <option value="credit">💳 Kartu Kredit</option>
                        </select>

                        <button 
                            onClick={handleCheckout}
                            disabled={isProcessing || cart.length === 0 || !selectedBranch}
                            className="w-full btn-primary py-4 text-lg font-bold flex justify-center items-center gap-2 shadow-xl shadow-pink-500/30"
                        >
                            {isProcessing ? (
                                <span className="animate-pulse">Memproses...</span>
                            ) : (
                                <>
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                                    PROSES PEMBAYARAN
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
