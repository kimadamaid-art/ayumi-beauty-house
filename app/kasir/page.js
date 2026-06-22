'use client'

import { useState, useEffect, Suspense } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter, useSearchParams } from 'next/navigation'

function PosPageContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
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

    useEffect(() => {
        const loadAutoBill = async () => {
            if (isLoading) return
            
            const pendingRecordId = searchParams.get('pendingRecordId')
            const appointmentId = searchParams.get('appointmentId')
            
            if (!pendingRecordId && !appointmentId) return

            let query = supabase
                .from('treatment_records')
                .select(`
                    id, treatment_time, treatment_date, branch_id,
                    patients(id, full_name, whatsapp),
                    treatment_record_items(treatment_id, price_at_time, discount_percent, treatments(name, price))
                `)

            if (pendingRecordId) {
                query = query.eq('id', pendingRecordId)
            } else if (appointmentId) {
                query = query.eq('appointment_id', appointmentId)
            }

            const { data } = await query.maybeSingle()
            if (data) {
                if (data.branch_id) {
                    setSelectedBranch(data.branch_id)
                }
                loadPendingBillToCart(data)
                
                const newUrl = window.location.pathname
                router.replace(newUrl)
            }
        }
        
        loadAutoBill()
    }, [isLoading, searchParams])

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

    // When branch changes, fetch available products for that branch and refresh pending bills
    useEffect(() => {
        if (selectedBranch) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            fetchProducts()
            fetchPendingBills(selectedBranch)
            setCart(prev => prev.filter(item => item.item_type !== 'product')) // Clear products from cart if branch changes
        } else {
            setProducts([])
            fetchPendingBills(null)
        }
    }, [selectedBranch])

    // Subscribe to realtime updates for pending bills
    useEffect(() => {
        if (!selectedBranch) return

        const channel = supabase
            .channel('realtime-kasir-pending-bills')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'treatment_records'
                },
                () => {
                    fetchPendingBills(selectedBranch)
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'transactions'
                },
                () => {
                    fetchPendingBills(selectedBranch)
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'appointments'
                },
                () => {
                    fetchPendingBills(selectedBranch)
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [selectedBranch])

    const fetchPendingBills = async (branchId) => {
        const todayStr = new Date().toISOString().split('T')[0]
        let query = supabase
            .from('treatment_records')
            .select(`
                id, treatment_time, treatment_date, branch_id,
                branches(name),
                patients(id, full_name, whatsapp),
                treatment_record_items(treatment_id, price_at_time, discount_percent, treatments(name, price))
            `)
            .eq('treatment_date', todayStr)
            .order('treatment_time', { ascending: true })

        if (branchId) {
            query = query.eq('branch_id', branchId)
        }

        const { data: trData } = await query
        if (!trData) return

        // Filter out already paid
        const { data: txData } = await supabase
            .from('transactions')
            .select('treatment_record_id')
            .gte('created_at', todayStr + 'T00:00:00Z')

        const txRecordIds = txData?.map(t => t.treatment_record_id).filter(Boolean) || []
        const pending = trData.filter(tr => !txRecordIds.includes(tr.id))
        setPendingBills(pending)
    }

    const handleOpenPendingModal = () => {
        fetchPendingBills(selectedBranch)
        setIsPendingModalOpen(true)
    }

    const loadPendingBillToCart = (bill) => {
        // Select patient
        setSelectedPatient(bill.patients)
        setSearchPatientQuery(bill.patients?.full_name || '')
        
        // Populate cart
        const newCart = bill.treatment_record_items.map(item => {
            const originalPrice = item.treatments?.price || item.price_at_time
            return {
                id: item.treatment_id, // For treatment
                item_type: 'treatment',
                name: item.treatments?.name || 'Treatment',
                price: item.price_at_time,
                original_price: originalPrice,
                discount_percent: item.discount_percent || 0,
                quantity: 1, // Usually 1 per item in treatment_records
                subtotal: item.price_at_time,
                treatment_record_id: bill.id // Temporary flag to attach to transaction later
            }
        })

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
                    original_price: item.price,
                    discount_percent: type === 'treatment' ? (item.discount_percent || 0) : 0,
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

    const handleCartItemOriginalPriceChange = (id, type, newOriginalPrice) => {
        const origPrice = Number(newOriginalPrice) || 0
        setCart(prev => prev.map(x => {
            if (x.id === id && x.item_type === type) {
                const pct = x.discount_percent || 0
                const newPrice = origPrice * (1 - pct / 100)
                return { ...x, original_price: origPrice, price: Math.round(newPrice) };
            }
            return x;
        }))
    }

    const handleCartItemDiscountChange = (id, type, percent) => {
        const pct = Math.min(100, Math.max(0, Number(percent) || 0))
        setCart(prev => prev.map(x => {
            if (x.id === id && x.item_type === type) {
                const newPrice = x.original_price * (1 - pct / 100);
                return { ...x, discount_percent: pct, price: Math.round(newPrice) };
            }
            return x;
        }))
    }

    const handleCartItemDiscountNominalChange = (id, type, nominalStr) => {
        const nominal = Math.max(0, Number(nominalStr) || 0)
        setCart(prev => prev.map(x => {
            if (x.id === id && x.item_type === type) {
                const checkedNominal = Math.min(x.original_price, nominal)
                const pct = x.original_price > 0 ? Math.round((checkedNominal / x.original_price) * 100) : 0
                const newPrice = x.original_price - checkedNominal
                return { ...x, discount_percent: Math.min(100, pct), price: Math.round(newPrice) };
            }
            return x;
        }))
    }

    const handleCartItemPriceChange = (id, type, newPrice) => {
        const price = Number(newPrice) || 0
        setCart(prev => prev.map(x => {
            if (x.id === id && x.item_type === type) {
                const pct = x.original_price > 0 ? Math.round(((x.original_price - price) / x.original_price) * 100) : 0
                return { ...x, price: price, discount_percent: Math.min(100, Math.max(0, pct)) }
            }
            return x
        }))
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

            // 5.5 Sync treatment prices and discounts back to treatment_record_items if loaded from a pending bill
            if (treatmentRecordId) {
                // Get all existing items for this treatment record to know their notes and check for deletion
                const { data: existingTrItems } = await supabase
                    .from('treatment_record_items')
                    .select('*')
                    .eq('treatment_record_id', treatmentRecordId)

                const cartTreatments = cart.filter(item => item.item_type === 'treatment')
                const cartTreatmentIds = cartTreatments.map(item => item.id)

                if (existingTrItems) {
                    // a. Delete items that were removed from the cart
                    const itemsToDelete = existingTrItems.filter(extItem => !cartTreatmentIds.includes(extItem.treatment_id))
                    for (const itemToDelete of itemsToDelete) {
                        await supabase
                            .from('treatment_record_items')
                            .delete()
                            .eq('treatment_record_id', treatmentRecordId)
                            .eq('treatment_id', itemToDelete.treatment_id)
                    }

                    // b. Update or insert treatments from the cart
                    let maxSortOrder = existingTrItems.reduce((max, item) => Math.max(max, item.sort_order || 0), 0)

                    for (const cartItem of cartTreatments) {
                        const existingMatch = existingTrItems.find(extItem => extItem.treatment_id === cartItem.id)

                        if (existingMatch) {
                            // Update existing item
                            await supabase
                                .from('treatment_record_items')
                                .update({
                                    price_at_time: cartItem.price,
                                    discount_percent: cartItem.discount_percent,
                                    original_price: cartItem.original_price
                                })
                                .eq('treatment_record_id', treatmentRecordId)
                                .eq('treatment_id', cartItem.id)
                        } else {
                            // Insert new treatment added by admin
                            maxSortOrder++
                            await supabase
                                .from('treatment_record_items')
                                .insert([{
                                    treatment_record_id: treatmentRecordId,
                                    treatment_id: cartItem.id,
                                    price_at_time: cartItem.price,
                                    original_price: cartItem.original_price,
                                    discount_percent: cartItem.discount_percent,
                                    sort_order: maxSortOrder,
                                    notes: 'Ditambahkan oleh Kasir/Admin'
                                }])
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

    // Additional UI state for collapsible add-item panel
    const [showAddItemPanel, setShowAddItemPanel] = useState(false)

    if (isLoading) {
        return <div className="p-8 text-center animate-pulse text-ayumi-text-muted">Memuat antarmuka kasir...</div>
    }

    return (
        <div className="flex flex-col lg:flex-row gap-5 h-[calc(100vh-100px)]">
            
            {/* ═══════════════════════════════════════════════════ */}
            {/* LEFT PANE */}
            {/* ═══════════════════════════════════════════════════ */}
            <div className="w-full lg:w-3/5 flex flex-col gap-4 overflow-y-auto custom-scrollbar pb-2">

                {/* ── Top bar: cabang + refresh ── */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col sm:flex-row justify-between items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-ayumi-primary to-rose-400 rounded-xl flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 5h2a2 2 0 002-2v-1a2 2 0 00-2-2h-2a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cabang Aktif</p>
                            {dbUser?.role === 'owner' ? (
                                <select 
                                    value={selectedBranch}
                                    onChange={(e) => setSelectedBranch(e.target.value)}
                                    className="text-sm font-bold text-ayumi-secondary bg-transparent border-none outline-none cursor-pointer"
                                >
                                    <option value="" disabled>-- Pilih Cabang --</option>
                                    {branches.map(b => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                            ) : (
                                <p className="text-sm font-bold text-ayumi-secondary">{branches.find(b => b.id === selectedBranch)?.name || 'Cabang'}</p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={() => fetchPendingBills(selectedBranch)}
                        className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-ayumi-primary bg-gray-100 hover:bg-pink-50 px-3 py-2 rounded-xl transition-all"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        Refresh
                    </button>
                </div>

                {/* ── Tagihan Menunggu Pembayaran ── */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-rose-50 to-pink-50">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 bg-rose-500 rounded-full animate-pulse"></span>
                            <h2 className="font-bold text-gray-800 text-sm">Tagihan Menunggu Pembayaran</h2>
                        </div>
                        <span className="bg-rose-100 text-rose-600 text-xs font-bold px-2.5 py-0.5 rounded-full">
                            {pendingBills.length} tagihan
                        </span>
                    </div>

                    {!selectedBranch ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
                            <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 5h2a2 2 0 002-2v-1a2 2 0 00-2-2h-2a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>
                            <p className="text-sm font-semibold">Pilih cabang terlebih dahulu</p>
                        </div>
                    ) : pendingBills.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
                            <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <p className="text-sm font-semibold">Semua tagihan hari ini sudah lunas</p>
                            <p className="text-xs text-gray-300">Tagihan baru akan muncul otomatis setelah terapis menyelesaikan treatment</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {pendingBills.map((bill) => {
                                const totalBill = bill.treatment_record_items?.reduce((s, i) => s + (i.price_at_time || 0), 0) || 0
                                const isLoaded = cart.some(c => c.treatment_record_id === bill.id)
                                return (
                                    <div
                                        key={bill.id}
                                        onClick={() => !isLoaded && loadPendingBillToCart(bill)}
                                        className={`flex items-center gap-4 px-5 py-4 transition-all ${
                                            isLoaded 
                                                ? 'bg-green-50 cursor-default' 
                                                : 'hover:bg-pink-50/50 cursor-pointer group'
                                        }`}
                                    >
                                        {/* Avatar */}
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                                            isLoaded ? 'bg-green-500' : 'bg-gradient-to-br from-ayumi-primary to-rose-400'
                                        }`}>
                                            {isLoaded 
                                                ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                                                : (bill.patients?.full_name?.charAt(0) || '?').toUpperCase()
                                            }
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <p className={`font-bold text-sm truncate ${ isLoaded ? 'text-green-700' : 'text-gray-800 group-hover:text-ayumi-primary'}`}>
                                                {bill.patients?.full_name || 'Pasien'}
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                <span className="text-xs text-gray-400">{bill.treatment_time?.substring(0,5) || '-'} WIB</span>
                                                <span className="text-gray-200">•</span>
                                                <span className="text-xs text-gray-500">
                                                    {bill.treatment_record_items?.length || 0} treatment
                                                </span>
                                            </div>
                                            {/* mini treatment tags */}
                                            <div className="flex flex-wrap gap-1 mt-1.5">
                                                {bill.treatment_record_items?.slice(0,3).map((it, i) => (
                                                    <span key={i} className="bg-purple-50 text-purple-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                                                        {it.treatments?.name?.split(' ').slice(0,2).join(' ') || 'Treatment'}
                                                    </span>
                                                ))}
                                                {(bill.treatment_record_items?.length || 0) > 3 && (
                                                    <span className="bg-gray-100 text-gray-500 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                                                        +{bill.treatment_record_items.length - 3} lainnya
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Total + Action */}
                                        <div className="text-right flex-shrink-0">
                                            <p className="font-mono font-bold text-sm text-ayumi-secondary">
                                                Rp {totalBill.toLocaleString('id-ID')}
                                            </p>
                                            {isLoaded ? (
                                                <span className="text-[10px] text-green-600 font-bold">Di Keranjang ✓</span>
                                            ) : (
                                                <span className="text-[10px] text-ayumi-primary font-bold group-hover:underline">Klik untuk proses →</span>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

            </div>


            {/* RIGHT PANE: CART & CHECKOUT */}
            <div className="w-full lg:w-2/5 flex flex-col bg-white rounded-3xl shadow-lg border border-gray-100 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-ayumi-secondary to-ayumi-primary"></div>
                
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
                                <div key={idx} className="flex flex-col bg-white p-4 rounded-2xl border border-gray-100 shadow-sm hover:border-pink-200 transition-all">
                                    {/* Top row: badge & delete button */}
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                            item.item_type === 'treatment' 
                                                ? 'bg-purple-100 text-purple-700' 
                                                : item.item_type === 'product'
                                                ? 'bg-orange-100 text-orange-700'
                                                : 'bg-pink-100 text-pink-700'
                                        }`}>
                                            {item.item_type === 'treatment' ? 'Treatment' : item.item_type === 'product' ? 'Produk Fisik' : 'Kupon Paket'}
                                        </span>
                                        <button 
                                            onClick={() => removeFromCart(item.id, item.item_type)}
                                            className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                            title="Hapus dari keranjang"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>

                                    {/* Item name */}
                                    <p className="font-bold text-gray-800 text-sm leading-snug mb-2">{item.name}</p>

                                    {/* 2x2 Interactive Price Grid */}
                                    <div className="grid grid-cols-2 gap-2 mt-1.5 pt-2 border-t border-dashed border-gray-100">
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 block mb-0.5">Harga Awal</label>
                                            <div className="relative">
                                                <span className="absolute left-1.5 top-1 text-[10px] text-gray-400 font-mono">Rp</span>
                                                <input 
                                                    type="number" 
                                                    value={item.original_price || 0} 
                                                    onChange={(e) => handleCartItemOriginalPriceChange(item.id, item.item_type, e.target.value)}
                                                    className="w-full text-xs font-semibold bg-gray-50 border border-gray-200 rounded-lg pl-5 pr-1 py-1 font-mono text-gray-700 focus:bg-white focus:border-pink-300 outline-none"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 block mb-0.5">Diskon (%)</label>
                                            <div className="relative">
                                                <input 
                                                    type="number" 
                                                    value={item.discount_percent || 0} 
                                                    onChange={(e) => handleCartItemDiscountChange(item.id, item.item_type, e.target.value)}
                                                    className="w-full text-xs font-semibold bg-gray-50 border border-gray-200 rounded-lg px-1.5 py-1 font-mono text-gray-700 focus:bg-white focus:border-pink-300 outline-none text-right pr-4"
                                                    min="0"
                                                    max="100"
                                                />
                                                <span className="absolute right-1.5 top-1 text-[10px] text-gray-400 font-mono">%</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 block mb-0.5">Potongan (Rp)</label>
                                            <div className="relative">
                                                <span className="absolute left-1.5 top-1 text-[10px] text-gray-400 font-mono">Rp</span>
                                                <input 
                                                    type="number" 
                                                    value={Math.max(0, (item.original_price || 0) - (item.price || 0))} 
                                                    onChange={(e) => handleCartItemDiscountNominalChange(item.id, item.item_type, e.target.value)}
                                                    className="w-full text-xs font-semibold bg-gray-50 border border-gray-200 rounded-lg pl-5 pr-1 py-1 font-mono text-gray-700 focus:bg-white focus:border-pink-300 outline-none text-right"
                                                    min="0"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 block mb-0.5">Harga Net</label>
                                            <div className="relative">
                                                <span className="absolute left-1.5 top-1 text-[10px] text-ayumi-primary font-bold">Rp</span>
                                                <input 
                                                    type="number" 
                                                    value={item.price || 0} 
                                                    onChange={(e) => handleCartItemPriceChange(item.id, item.item_type, e.target.value)}
                                                    className="w-full text-xs font-bold bg-pink-50/50 border border-pink-100 rounded-lg pl-5 pr-1 py-1 font-mono text-ayumi-primary focus:bg-white focus:border-pink-300 outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Bottom row: quantity controls & item subtotal */}
                                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                                        <div className="flex items-center gap-1.5 bg-gray-50 rounded-lg p-0.5 border border-gray-200">
                                            <button 
                                                onClick={() => updateCartQty(item.id, item.item_type, -1)} 
                                                className="w-5.5 h-5.5 flex items-center justify-center text-gray-600 bg-white rounded shadow-sm hover:bg-gray-100 font-bold text-xs"
                                            >-</button>
                                            <span className="font-bold text-xs w-4 text-center text-gray-700">{item.quantity}</span>
                                            <button 
                                                onClick={() => updateCartQty(item.id, item.item_type, 1)} 
                                                className="w-5.5 h-5.5 flex items-center justify-center text-gray-600 bg-white rounded shadow-sm hover:bg-gray-100 font-bold text-xs"
                                            >+</button>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-[9px] font-bold text-gray-400 block">Subtotal</span>
                                            <span className="font-mono font-bold text-xs text-ayumi-secondary">
                                                Rp {((item.price || 0) * item.quantity).toLocaleString('id-ID')}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="border-t border-dashed border-gray-100 mx-0">
                        <button
                            onClick={() => setShowAddItemPanel(prev => !prev)}
                            className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50/80 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <div className="w-5 h-5 bg-ayumi-primary/10 rounded-full flex items-center justify-center">
                                    <svg className="w-3 h-3 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                </div>
                                <span className="font-bold text-sm text-ayumi-primary">Tambah Item</span>
                                <span className="text-xs text-gray-400 font-normal">untuk {selectedPatient?.full_name || 'pasien ini'}</span>
                            </div>
                            <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showAddItemPanel ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                        </button>

                        {showAddItemPanel && (
                            <div className="bg-gray-50/50 border-t border-gray-100">
                                {/* Tabs */}
                                <div className="flex bg-white border border-gray-100 p-1 mx-4 mt-3 rounded-xl shadow-sm">
                                    {[
                                        { key: 'treatment', label: 'Treatment', color: 'text-purple-600' },
                                        { key: 'product', label: 'Produk', color: 'text-orange-600' },
                                        { key: 'coupon', label: 'Kupon', color: 'text-pink-600' },
                                    ].map(tab => (
                                        <button
                                            key={tab.key}
                                            onClick={() => setActiveTab(tab.key)}
                                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                activeTab === tab.key ? `bg-gray-100 ${tab.color}` : 'text-gray-400 hover:text-gray-600'
                                            }`}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Search */}
                                <div className="px-4 pt-3 pb-2">
                                    <div className="relative">
                                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                        </span>
                                        <input
                                            type="text"
                                            placeholder={`Cari ${activeTab === 'treatment' ? 'treatment' : activeTab === 'product' ? 'produk skincare' : 'kupon'}...`}
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="input-ayumi pl-8 bg-white w-full text-xs py-2"
                                        />
                                    </div>
                                </div>

                                {/* Items List (vertical, more compact) */}
                                <div className="px-4 pb-3 max-h-56 overflow-y-auto custom-scrollbar">
                                    {!selectedBranch && activeTab === 'product' ? (
                                        <div className="text-center text-gray-400 py-4 text-xs">Pilih cabang terlebih dahulu</div>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {activeTab === 'treatment' && treatments
                                                .filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                                .map(t => {
                                                    const hasDiscount = t.discount_percent > 0
                                                    const price = hasDiscount ? t.price * (1 - t.discount_percent / 100) : t.price
                                                    return (
                                                        <button
                                                            key={t.id}
                                                            type="button"
                                                            onClick={() => addToCart(t, 'treatment')}
                                                            className="w-full flex items-center justify-between bg-white px-3 py-2.5 rounded-xl border border-purple-100 hover:border-purple-300 hover:bg-purple-50/30 transition-all group text-left"
                                                        >
                                                            <span className="font-semibold text-xs text-gray-800 group-hover:text-purple-700 truncate pr-2">{t.name}</span>
                                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                                                {hasDiscount && <span className="text-[9px] line-through text-gray-400">Rp {t.price.toLocaleString('id-ID')}</span>}
                                                                <span className="font-mono font-bold text-xs text-ayumi-primary">Rp {price.toLocaleString('id-ID')}</span>
                                                                <span className="w-5 h-5 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">+</span>
                                                            </div>
                                                        </button>
                                                    )
                                                })
                                            }
                                            {activeTab === 'product' && products
                                                .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                                .map(p => (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() => addToCart(p, 'product')}
                                                        className="w-full flex items-center justify-between bg-white px-3 py-2.5 rounded-xl border border-orange-100 hover:border-orange-300 hover:bg-orange-50/30 transition-all group text-left"
                                                    >
                                                        <div className="flex items-center gap-2 truncate">
                                                            <span className="font-semibold text-xs text-gray-800 group-hover:text-orange-700 truncate">{p.name}</span>
                                                            <span className="bg-orange-100 text-orange-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">Stok: {p.quantity}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                                            <span className="font-mono font-bold text-xs text-orange-600">Rp {p.price.toLocaleString('id-ID')}</span>
                                                            <span className="w-5 h-5 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">+</span>
                                                        </div>
                                                    </button>
                                                ))
                                            }
                                            {activeTab === 'coupon' && coupons
                                                .filter(c => !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                                .map(c => (
                                                    <button
                                                        key={c.id}
                                                        type="button"
                                                        onClick={() => addToCart(c, 'coupon')}
                                                        className="w-full flex items-center justify-between bg-white px-3 py-2.5 rounded-xl border border-pink-200 hover:border-pink-400 hover:bg-pink-50/30 transition-all group text-left"
                                                    >
                                                        <span className="font-semibold text-xs text-gray-800 group-hover:text-pink-700 truncate pr-2">{c.name}</span>
                                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                                            <span className="font-mono font-bold text-xs text-pink-600">Rp {c.price.toLocaleString('id-ID')}</span>
                                                            <span className="w-5 h-5 bg-pink-100 text-pink-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">+</span>
                                                        </div>
                                                    </button>
                                                ))
                                            }
                                        </div>
                                    )}
                                </div>
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

export default function PosPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-ayumi-text-muted animate-pulse">Memuat antarmuka kasir...</div>}>
            <PosPageContent />
        </Suspense>
    )
}
