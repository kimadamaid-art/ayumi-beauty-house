'use client'

import { useState, useEffect, Suspense } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter, useSearchParams } from 'next/navigation'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import BranchFilter from '@/components/ui/BranchFilter'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton'
import { usePatientSearch } from '@/hooks/usePatientSearch'

function PosPageContent() {
    const router = useRouter()
    const searchParams = useSearchParams()

    // Auth & Branches
    const [dbUser, setDbUser] = useState(null)
    const [branches, setBranches] = useState([])
    const [selectedBranch, setSelectedBranch] = useState('')
    const [isLoading, setIsLoading] = useState(true)

    // Data
    const [treatments, setTreatments] = useState([])
    const [products, setProducts] = useState([])
    const [coupons, setCoupons] = useState([])
    const [pendingBills, setPendingBills] = useState([])
    const [therapists, setTherapists] = useState([])
    const [selectedTherapistId, setSelectedTherapistId] = useState('')
    
    // Patient Search Hook (server-side, debounce 350ms, limit 20, sequence tracked)
    const {
        searchQuery: searchPatientQuery,
        setSearchQuery: setSearchPatientQuery,
        results: patientSearchResults,
        isSearching: isSearchingPatient,
        hasSearched: hasSearchedPatient,
        resetSearch: resetPatientSearch
    } = usePatientSearch({ debounceMs: 350, limit: 20 })

    // UI State
    const [activeTab, setActiveTab] = useState('treatment') // 'treatment' | 'product' | 'coupon'
    const [searchQuery, setSearchQuery] = useState('')
    const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false)
    const [isPendingModalOpen, setIsPendingModalOpen] = useState(false)
    const [leftPanelTab, setLeftPanelTab] = useState('pending')
    const [expandedCartItem, setExpandedCartItem] = useState(null)
    const [patientActiveCoupons, setPatientActiveCoupons] = useState([])

    // Quick Add Patient State
    const [quickAddForm, setQuickAddForm] = useState({ full_name: '', whatsapp: '' })
    const [isQuickAdding, setIsQuickAdding] = useState(false)
    const [quickAddError, setQuickAddError] = useState('')
    const [selectedPatientDetails, setSelectedPatientDetails] = useState(null)
    const [isQuickAddInlineOpen, setIsQuickAddInlineOpen] = useState(false)

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
                if (uData.role === 'therapist') {
                    router.push('/therapist/dashboard')
                    return
                }
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

        // Fetch active therapists
        const { data: thData } = await supabase.from('users').select('id, full_name').eq('role', 'therapist').eq('is_active', true).order('full_name')
        if (thData) setTherapists(thData)

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

    async function handleSelectPatient(patient) {
        setSelectedPatient(patient)
        setSearchPatientQuery('')
        setIsPatientDropdownOpen(false)
        setSelectedPatientDetails(null)

        const { data: trData } = await supabase
            .from('treatment_records')
            .select('treatment_date')
            .eq('patient_id', patient.id)
            .order('treatment_date', { ascending: false })

        let crmStatus = 'New'
        let transactionCount = 0

        if (trData && trData.length > 0) {
            transactionCount = trData.length
            const lastVisit = new Date(trData[0].treatment_date)
            const daysSinceLastVisit = Math.floor((new Date() - lastVisit) / (1000 * 60 * 60 * 24))
            
            if (daysSinceLastVisit <= 30) crmStatus = 'Active'
            else if (daysSinceLastVisit <= 90) crmStatus = 'Warm'
            else crmStatus = 'Dormant'
        }

        setSelectedPatientDetails({ crmStatus, transactionCount })

        // Fetch active coupons for this patient
        const { data: pcData } = await supabase
            .from('patient_coupons')
            .select('id')
            .eq('patient_id', patient.id)
            .eq('status', 'active')

        const activeCouponIds = pcData?.map(pc => pc.id) || []
        let activeCouponItems = []

        if (activeCouponIds.length > 0) {
            const { data: itemsData } = await supabase
                .from('patient_coupon_items')
                .select(`
                    id, patient_coupon_id, treatment_id, total_sessions, used_sessions, remaining_sessions, status,
                    treatments (name),
                    patient_coupons (status, coupon_packages(name))
                `)
                .eq('status', 'active')
                .in('patient_coupon_id', activeCouponIds)
                .gt('remaining_sessions', 0)

            if (itemsData) activeCouponItems = itemsData
        }

        setPatientActiveCoupons(activeCouponItems)

        // Auto-apply coupon to existing treatment items in cart
        if (activeCouponItems.length > 0) {
            setCart(prev => prev.map(cartItem => {
                if (cartItem.item_type === 'treatment') {
                    const match = activeCouponItems.find(c => c.treatment_id === cartItem.id && c.remaining_sessions > 0)
                    if (match) {
                        return {
                            ...cartItem,
                            is_using_coupon: true,
                            used_coupon_item_id: match.id,
                            coupon_package_name: match.patient_coupons?.coupon_packages?.name || 'Paket Kupon',
                            remaining_sessions: match.remaining_sessions,
                            price: 0,
                            discount_percent: 100
                        }
                    }
                }
                return cartItem
            }))
        }

        return activeCouponItems
    }

    async function handleQuickAddPatient(e) {
        e?.preventDefault()
        if (!quickAddForm.full_name || !quickAddForm.whatsapp) {
            setQuickAddError('Nama dan WA wajib diisi.')
            return
        }
        setIsQuickAdding(true)
        setQuickAddError('')

        try {
            // 1. Validasi WhatsApp
            const { data: existingWa } = await supabase
                .from('patients')
                .select('id')
                .eq('whatsapp', quickAddForm.whatsapp)
                .maybeSingle()
                
            if (existingWa) {
                setQuickAddError('Nomor WhatsApp ini sudah terdaftar.')
                setIsQuickAdding(false)
                return
            }

            // 2. Warning Nama Duplikat
            const { data: existingNames } = await supabase
                .from('patients')
                .select('id, whatsapp')
                .ilike('full_name', quickAddForm.full_name.trim())
                .limit(1)

            if (existingNames && existingNames.length > 0) {
                const proceed = window.confirm(`PERINGATAN: Pasien dengan nama "${quickAddForm.full_name}" sudah terdaftar (WA: ${existingNames[0].whatsapp || '-'}).\n\nYakin ingin tetap menambahkan sebagai pasien baru?`)
                if (!proceed) {
                    setIsQuickAdding(false)
                    return
                }
            }

            // 3. Insert dengan branch_id
            const { data, error } = await supabase
                .from('patients')
                .insert([{
                    full_name: quickAddForm.full_name,
                    whatsapp: quickAddForm.whatsapp,
                    branch_id: selectedBranch || null,
                    is_active: true
                }])
                .select()
                .single()

            if (error) throw error

            handleSelectPatient(data)
            setQuickAddForm({ full_name: '', whatsapp: '' })
            setIsQuickAddInlineOpen(false)
        } catch (err) {
            console.error(err)
            let msg = err.message
            if (msg.includes('unique constraint') || msg.includes('23505')) {
                msg = 'Nomor WhatsApp ini sudah terdaftar sebagai pasien'
            }
            setQuickAddError('Gagal menambahkan pasien: ' + msg)
        } finally {
            setIsQuickAdding(false)
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
                id, treatment_time, treatment_date, branch_id, performed_by,
                branches(name),
                patients(id, full_name, whatsapp),
                treatment_record_items(treatment_id, price_at_time, discount_percent, original_price, commission_percent, treatments(name, price, commission_percent)),
                coupon_usage_logs(id, patient_coupon_item_id, patient_coupon_items(id, treatment_id, total_sessions, used_sessions, remaining_sessions, patient_coupons(coupon_packages(name))))
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
        setLeftPanelTab(prev => (prev === 'pending' && pending.length === 0) ? 'catalog' : prev)
    }

    const handleOpenPendingModal = () => {
        fetchPendingBills(selectedBranch)
        setIsPendingModalOpen(true)
    }

    const loadPendingBillToCart = async (bill) => {
        let activeCoupons = []

        // Select patient and fetch active coupons
        if (bill.patients) {
            activeCoupons = await handleSelectPatient(bill.patients)
        }
        
        // Fetch or check coupon usage logs already linked to this treatment record
        let existingCouponLogs = bill.coupon_usage_logs || []
        if (!bill.coupon_usage_logs || bill.coupon_usage_logs.length === 0) {
            const { data: logs } = await supabase
                .from('coupon_usage_logs')
                .select('id, patient_coupon_item_id, patient_coupon_items(id, treatment_id, total_sessions, used_sessions, remaining_sessions, patient_coupons(coupon_packages(name)))')
                .eq('treatment_record_id', bill.id)
            if (logs && logs.length > 0) existingCouponLogs = logs
        }
        
        // Populate cart
        const newCart = (bill.treatment_record_items || []).map(item => {
            const originalPrice = Number(item.treatments?.price) || Number(item.original_price) || Number(item.price_at_time) || 0
            
            // Check if therapist ALREADY deducted a coupon for this treatment record
            const alreadyUsedLog = existingCouponLogs.find(log => 
                log.patient_coupon_items?.treatment_id === item.treatment_id ||
                log.patient_coupon_item_id === item.treatment_id
            ) || (existingCouponLogs.length > 0 && (Number(item.price_at_time) === 0 || item.discount_percent === 100) ? existingCouponLogs[0] : null)

            if (alreadyUsedLog) {
                // Was already deducted by therapist/treatment record!
                const cpItem = alreadyUsedLog.patient_coupon_items
                const pkgName = cpItem?.patient_coupons?.coupon_packages?.name || 'Paket Kupon'
                return {
                    id: item.treatment_id,
                    item_type: 'treatment',
                    name: item.treatments?.name || 'Treatment',
                    price: 0,
                    original_price: originalPrice,
                    discount_percent: 100,
                    quantity: 1,
                    subtotal: 0,
                    treatment_record_id: bill.id,
                    commission_percent: item.commission_percent || item.treatments?.commission_percent || 0,
                    is_using_coupon: true,
                    coupon_already_deducted: true, // CRITICAL: Already deducted by therapist in medical record! Do NOT deduct again at checkout.
                    used_coupon_item_id: alreadyUsedLog.patient_coupon_item_id,
                    coupon_package_name: pkgName,
                    remaining_sessions: cpItem?.remaining_sessions || 0
                }
            }

            // If not deducted by therapist, retain price from treatment record
            const price = Number(item.price_at_time || 0)

            return {
                id: item.treatment_id,
                item_type: 'treatment',
                name: item.treatments?.name || 'Treatment',
                price: price,
                original_price: originalPrice,
                discount_percent: item.discount_percent || 0,
                quantity: 1,
                subtotal: price,
                treatment_record_id: bill.id,
                commission_percent: item.commission_percent || item.treatments?.commission_percent || 0,
                is_using_coupon: false,
                coupon_already_deducted: false,
                used_coupon_item_id: null,
                coupon_package_name: '',
                remaining_sessions: 0
            }
        })

        setCart(newCart)
        setIsPendingModalOpen(false)
        setLeftPanelTab('catalog')
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
                // Check active coupon for treatment
                let isUsingCoupon = false
                let usedCouponItemId = null
                let couponPackageName = ''
                let remainingSessions = 0

                let price = item.price
                if (type === 'treatment' && patientActiveCoupons.length > 0) {
                    const match = patientActiveCoupons.find(c => c.treatment_id === item.id && c.remaining_sessions > 0)
                    if (match) {
                        isUsingCoupon = true
                        usedCouponItemId = match.id
                        couponPackageName = match.patient_coupons?.coupon_packages?.name || 'Paket Kupon'
                        remainingSessions = match.remaining_sessions
                        price = 0
                    }
                }

                if (!isUsingCoupon && type === 'treatment' && item.discount_percent > 0) {
                    price = item.price * (1 - item.discount_percent / 100)
                }

                return [...prev, {
                    id: item.id,
                    item_type: type,
                    name: item.name,
                    price: price,
                    original_price: item.price,
                    discount_percent: isUsingCoupon ? 100 : (type === 'treatment' ? (item.discount_percent || 0) : 0),
                    quantity: 1,
                    maxQuantity: type === 'product' ? item.quantity : null,
                    commission_percent: type === 'treatment' ? (item.commission_percent || 0) : 0,
                    is_using_coupon: isUsingCoupon,
                    coupon_already_deducted: false, // direct pos addition, will deduct upon checkout
                    used_coupon_item_id: usedCouponItemId,
                    coupon_package_name: couponPackageName,
                    remaining_sessions: remainingSessions
                }]
            }
        })
    }

    const toggleCartItemCoupon = (itemId) => {
        setCart(prev => prev.map(cartItem => {
            if (cartItem.id === itemId && cartItem.item_type === 'treatment') {
                if (cartItem.is_using_coupon) {
                    // Switch to normal price
                    let orig = cartItem.original_price || 0
                    let discPct = cartItem.discount_percent === 100 ? 0 : cartItem.discount_percent
                    let normalPrice = orig * (1 - discPct / 100)
                    return {
                        ...cartItem,
                        is_using_coupon: false,
                        coupon_already_deducted: false,
                        used_coupon_item_id: null,
                        price: Math.round(normalPrice),
                        discount_percent: discPct
                    }
                } else {
                    // Switch to coupon
                    const match = patientActiveCoupons.find(c => c.treatment_id === cartItem.id && c.remaining_sessions > 0)
                    if (match) {
                        return {
                            ...cartItem,
                            is_using_coupon: true,
                            coupon_already_deducted: false, // will deduct upon checkout
                            used_coupon_item_id: match.id,
                            coupon_package_name: match.patient_coupons?.coupon_packages?.name || 'Paket Kupon',
                            remaining_sessions: match.remaining_sessions,
                            price: 0,
                            discount_percent: 100
                        }
                    } else {
                        alert('Pasien tidak memiliki kupon paket aktif yang tersisa untuk treatment ini.')
                    }
                }
            }
            return cartItem
        }))
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
    const afterDiscountTotal = Math.max(0, subtotal - discountAmount)
    const qrisFee = paymentMethod === 'qris' ? Math.round(afterDiscountTotal * 0.003) : 0
    const total = afterDiscountTotal + qrisFee

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

        const hasDirectTreatment = cart.some(item => item.item_type === 'treatment' && !item.treatment_record_id)
        if (hasDirectTreatment && !selectedTherapistId) {
            alert('Silakan pilih terapis yang melakukan tindakan treatment!')
            return
        }

        setIsProcessing(true)

        try {
            // Extract treatment_record_id if we loaded from pending bills
            let treatmentRecordId = cart.find(i => i.treatment_record_id)?.treatment_record_id || null

            // If it is a direct treatment checkout, create a parent treatment record first
            if (hasDirectTreatment) {
                const { data: newTr, error: trErr } = await supabase
                    .from('treatment_records')
                    .insert([{
                        patient_id: selectedPatient?.id || null,
                        branch_id: selectedBranch,
                        performed_by: selectedTherapistId,
                        treatment_date: new Date().toISOString().split('T')[0],
                        treatment_time: new Date().toLocaleTimeString('en-US', { hour12: false })
                    }])
                    .select()
                    .single()

                if (trErr) throw trErr
                treatmentRecordId = newTr.id
            }

            // Prepare items payload for RPC
            const itemsPayload = cart.map(item => ({
                id: item.id,
                item_type: item.item_type,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                original_price: item.original_price || 0,
                discount_percent: item.discount_percent || 0,
                commission_percent: item.commission_percent || 0
            }))

            const actualDiscountAmount = discountType === 'percent'
                ? Math.round(subtotal * (Number(discountValue) / 100))
                : Number(discountValue) || 0

            // Call the atomic database RPC
            const { data: trxData, error: rpcError } = await supabase
                .rpc('process_checkout', {
                    p_patient_id: selectedPatient?.id || null,
                    p_branch_id: selectedBranch,
                    p_treatment_record_id: treatmentRecordId,
                    p_cashier_id: dbUser?.id,
                    p_subtotal: subtotal,
                    p_discount: actualDiscountAmount,
                    p_discount_type: discountType,
                    p_total: total,
                    p_payment_method: paymentMethod,
                    p_payment_status: 'paid',
                    p_notes: notes,
                    p_created_by: dbUser?.id,
                    p_items: itemsPayload
                })

            if (rpcError) throw rpcError

            if (!trxData || !trxData.id) {
                throw new Error('Gagal mendapatkan data transaksi dari database.')
            }

            // Deduct sessions for items using coupon (ONLY if not already deducted by therapist/treatment record)
            for (const cartItem of cart) {
                if (cartItem.is_using_coupon && cartItem.used_coupon_item_id && !cartItem.coupon_already_deducted && selectedPatient) {
                    try {
                        await supabase.from('coupon_usage_logs').insert([{
                            patient_coupon_item_id: cartItem.used_coupon_item_id,
                            patient_id: selectedPatient.id,
                            treatment_record_id: cartItem.treatment_record_id || null,
                            branch_id: selectedBranch,
                            used_by: dbUser?.id || null,
                            notes: `Klaim Kasir (No. Tx: ${trxData.id?.substring(0, 8)})`
                        }])

                        const { data: currentCpItem } = await supabase
                            .from('patient_coupon_items')
                            .select('used_sessions, remaining_sessions, total_sessions, patient_coupon_id')
                            .eq('id', cartItem.used_coupon_item_id)
                            .single()

                        if (currentCpItem) {
                            const newUsed = (currentCpItem.used_sessions || 0) + cartItem.quantity
                            const newRemaining = Math.max(0, (currentCpItem.remaining_sessions || 0) - cartItem.quantity)
                            const newStatus = newRemaining === 0 ? 'fully_used' : 'active'

                            await supabase
                                .from('patient_coupon_items')
                                .update({
                                    used_sessions: newUsed,
                                    remaining_sessions: newRemaining,
                                    status: newStatus
                                })
                                .eq('id', cartItem.used_coupon_item_id)

                            if (newRemaining === 0) {
                                const { data: siblings } = await supabase
                                    .from('patient_coupon_items')
                                    .select('status')
                                    .eq('patient_coupon_id', currentCpItem.patient_coupon_id)

                                const allDone = siblings ? siblings.every(s => s.status === 'fully_used' || s.status === 'completed') : true
                                if (allDone) {
                                    await supabase
                                        .from('patient_coupons')
                                        .update({ status: 'fully_used' })
                                        .eq('id', currentCpItem.patient_coupon_id)
                                }
                            }
                        }
                    } catch (cpErr) {
                        console.error('Error updating coupon deduction:', cpErr)
                    }
                }
            }

            // Navigate to Receipt page
            setSelectedTherapistId('')
            router.push(`/kasir/transactions/${trxData.id}`)
            
        } catch (error) {
            console.error(error)
            alert('Terjadi kesalahan saat memproses pembayaran: ' + getFriendlyErrorMessage(error))
            setIsProcessing(false)
        }
    }

    // Additional UI state for collapsible add-item panel
    const [showAddItemPanel, setShowAddItemPanel] = useState(false)

    if (isLoading) {
        return <div className="p-5 md:p-8 text-center animate-pulse text-ayumi-text-muted">Memuat antarmuka kasir...</div>
    }

    return (
        <div className="flex flex-col lg:flex-row gap-5 lg:h-[calc(100vh-100px)] min-h-max">
            
            {/* ═══════════════════════════════════════════════════ */}
            {/* LEFT PANE */}
            {/* ═══════════════════════════════════════════════════ */}
            <div className="w-full lg:w-3/5 flex flex-col gap-3 overflow-y-auto custom-scrollbar pb-2">

                {/* ── Top bar: cabang + refresh ── */}
                <div className="bg-white rounded-xl border border-gray-100 shadow-xs p-3 sm:p-3.5 flex flex-col sm:flex-row justify-between items-center gap-2.5">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-gradient-to-br from-ayumi-primary to-rose-400 rounded-lg flex items-center justify-center">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 5h2a2 2 0 002-2v-1a2 2 0 00-2-2h-2a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none">Cabang Aktif</p>
                            {dbUser?.role === 'owner' ? (
                                <select 
                                    value={selectedBranch}
                                    onChange={(e) => setSelectedBranch(e.target.value)}
                                    className="text-xs sm:text-sm font-bold text-ayumi-secondary bg-transparent border-none outline-none cursor-pointer mt-0.5"
                                >
                                    <option value="" disabled>-- Pilih Cabang --</option>
                                    {branches.map(b => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                            ) : (
                                <p className="text-xs sm:text-sm font-bold text-ayumi-secondary mt-0.5">{branches.find(b => b.id === selectedBranch)?.name || 'Cabang'}</p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={() => fetchPendingBills(selectedBranch)}
                        className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-ayumi-primary bg-gray-100 hover:bg-pink-50 px-2.5 py-1.5 rounded-lg transition-all cursor-pointer"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        Refresh
                    </button>
                </div>

                {/* ── Left Pane Tabs (Pending Bills vs Catalog) ── */}
                <div className="flex bg-white rounded-xl border border-gray-100 p-1 shadow-xs">
                    <button
                        type="button"
                        onClick={() => setLeftPanelTab('pending')}
                        className={`flex-1 py-2.5 rounded-lg text-xs sm:text-sm font-extrabold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                            leftPanelTab === 'pending'
                                ? 'bg-gradient-to-r from-rose-50 to-pink-50 text-ayumi-primary shadow-xs border border-pink-100/50'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <span className="relative flex h-2 w-2">
                            {pendingBills.length > 0 && (
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                            )}
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${pendingBills.length > 0 ? 'bg-rose-500' : 'bg-gray-300'}`}></span>
                        </span>
                        Tagihan Menunggu ({pendingBills.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setLeftPanelTab('catalog')}
                        className={`flex-1 py-2.5 rounded-lg text-xs sm:text-sm font-extrabold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                            leftPanelTab === 'catalog'
                                ? 'bg-gradient-to-r from-rose-50 to-pink-50 text-ayumi-primary shadow-xs border border-pink-100/50'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
                        <span>Katalog Item</span>
                    </button>
                </div>

                {/* Left Panel Tab Content */}
                {leftPanelTab === 'pending' ? (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-xs overflow-hidden flex-1 flex flex-col">
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
                            <h2 className="font-bold text-gray-800 text-xs sm:text-sm">Daftar Tagihan Menunggu</h2>
                            <span className="bg-rose-100 text-rose-600 text-[11px] font-bold px-2 py-0.5 rounded-full">
                                {pendingBills.length} Tagihan
                            </span>
                        </div>

                        {!selectedBranch ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-2 text-gray-400 my-auto">
                                <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 5h2a2 2 0 002-2v-1a2 2 0 00-2-2h-2a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>
                                <p className="text-sm font-semibold">Pilih cabang terlebih dahulu</p>
                            </div>
                        ) : pendingBills.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-2 text-gray-400 my-auto text-center px-6">
                                <svg className="w-10 h-10 text-gray-200 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                <p className="text-sm font-bold text-gray-700">Semua tagihan hari ini sudah lunas</p>
                                <p className="text-xs text-gray-400 max-w-xs leading-relaxed">Tagihan baru dari terapis akan muncul otomatis setelah treatment selesai</p>
                            </div>
                        ) : (
                            <div className="p-4.5 space-y-3 overflow-y-auto max-h-[60vh] custom-scrollbar">
                                {pendingBills.map((bill) => {
                                    const totalBill = bill.treatment_record_items?.reduce((s, i) => s + (i.price_at_time || 0), 0) || 0
                                    const isLoaded = cart.some(c => c.treatment_record_id === bill.id)
                                    return (
                                        <div
                                            key={bill.id}
                                            onClick={() => !isLoaded && loadPendingBillToCart(bill)}
                                            className={`flex items-center gap-4 px-4.5 py-4 rounded-2xl border transition-all duration-200 ${
                                                isLoaded 
                                                    ? 'bg-emerald-50/80 border-emerald-100/60 shadow-sm cursor-default' 
                                                    : 'bg-white border-gray-100 hover:border-pink-200 hover:shadow-md hover:scale-[1.01] cursor-pointer group shadow-[0_2px_8px_rgba(0,0,0,0.02)]'
                                            }`}
                                        >
                                            {/* Avatar */}
                                            <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0 transition-transform duration-200 ${
                                                isLoaded ? 'bg-emerald-500 scale-105 shadow-md shadow-emerald-500/20' : 'bg-gradient-to-br from-ayumi-primary to-rose-400 group-hover:scale-105 shadow-sm'
                                            }`}>
                                                {isLoaded 
                                                    ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                                                    : (bill.patients?.full_name?.charAt(0) || '?').toUpperCase()
                                                }
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <p className={`font-extrabold text-sm truncate ${ isLoaded ? 'text-emerald-800' : 'text-gray-800 group-hover:text-ayumi-primary'}`}>
                                                    {bill.patients?.full_name || 'Pasien'}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                    <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                                                        Hari ini, {bill.treatment_time?.substring(0,5) || '-'} WIB
                                                    </span>
                                                    <span className="text-xs font-semibold text-gray-500">
                                                        {bill.treatment_record_items?.length || 0} Treatment
                                                    </span>
                                                </div>
                                                {/* mini treatment tags */}
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {bill.treatment_record_items?.slice(0,3).map((it, i) => (
                                                        <span key={i} className="bg-purple-50/70 text-purple-700 border border-purple-100/50 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                                            {it.treatments?.name?.split(' ').slice(0,2).join(' ') || 'Treatment'}
                                                        </span>
                                                    ))}
                                                    {(bill.treatment_record_items?.length || 0) > 3 && (
                                                        <span className="bg-gray-100 text-gray-500 border border-gray-200 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                                            +{bill.treatment_record_items.length - 3} lainnya
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Total + Action */}
                                            <div className="text-right flex-shrink-0">
                                                <p className=" font-black text-sm text-ayumi-secondary">
                                                    Rp {totalBill.toLocaleString('id-ID')}
                                                </p>
                                                {isLoaded ? (
                                                    <span className="text-[10px] text-emerald-600 font-extrabold flex items-center justify-end gap-0.5 mt-1">
                                                        Di Keranjang ✓
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-ayumi-primary font-bold group-hover:underline flex items-center justify-end gap-0.5 mt-1">
                                                        Klik untuk bayar →
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    /* ── Katalog Item (Grid POS) ── */
                    <div className="bg-white rounded-xl border border-gray-100 shadow-xs overflow-hidden flex-1 flex flex-col">
                        
                        {/* Subtabs catalog */}
                        <div className="flex flex-col sm:flex-row items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-2.5 gap-2.5">
                            <div className="flex bg-gray-100/80 border border-gray-200 p-0.5 rounded-xl flex-1 max-w-md w-full">
                                {[
                                    { key: 'treatment', label: 'Layanan Treatment' },
                                    { key: 'product', label: 'Produk Skincare' },
                                    { key: 'coupon', label: 'Paket Kupon' },
                                ].map(tab => (
                                    <button
                                        key={tab.key}
                                        type="button"
                                        onClick={() => setActiveTab(tab.key)}
                                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                            activeTab === tab.key 
                                                ? 'bg-white text-ayumi-primary shadow-xs font-extrabold' 
                                                : 'text-gray-500 hover:text-gray-800'
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                            
                            {/* Search bar inside Catalog tab header */}
                            <div className="relative w-full sm:w-52 flex-shrink-0">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-gray-400">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                </span>
                                <input
                                    type="text"
                                    placeholder="Cari menu / item..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="input-ayumi pl-8 bg-white w-full text-xs py-1.5 border-gray-200 focus:border-pink-300 rounded-lg"
                                />
                            </div>
                        </div>

                        {/* Items list rendered as POS card grid */}
                        <div className="p-3 sm:p-4 overflow-y-auto max-h-[66vh] custom-scrollbar flex-1 bg-gray-50/30">
                            {!selectedBranch && activeTab === 'product' ? (
                                <div className="flex flex-col items-center justify-center py-16 text-gray-400 text-center my-auto">
                                    <svg className="w-8 h-8 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 5h2a2 2 0 002-2v-1a2 2 0 00-2-2h-2a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>
                                    <p className="text-xs font-semibold">Pilih cabang terlebih dahulu untuk melihat stok produk</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
                                    {activeTab === 'treatment' && treatments
                                        .filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                        .map(t => {
                                             const hasDiscount = t.discount_percent > 0
                                             const price = hasDiscount ? t.price * (1 - t.discount_percent / 100) : t.price
                                             return (
                                                 <div
                                                     key={t.id}
                                                     onClick={() => addToCart(t, 'treatment')}
                                                     className="bg-white p-3 rounded-xl border border-gray-200 shadow-xs flex flex-col justify-between hover:border-pink-300 hover:shadow-sm transition-all cursor-pointer group relative"
                                                 >
                                                     <div className="space-y-1 mb-2">
                                                         {hasDiscount && (
                                                             <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[9px] font-extrabold px-1.5 py-0.5 rounded inline-block">
                                                                 Diskon {t.discount_percent}%
                                                             </span>
                                                         )}
                                                         <h4 className="font-bold text-xs sm:text-sm text-gray-900 line-clamp-2 leading-snug group-hover:text-ayumi-primary transition-colors">
                                                             {t.name}
                                                         </h4>
                                                     </div>

                                                     <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-auto gap-1.5">
                                                         <div className="flex flex-col min-w-0">
                                                             {hasDiscount && (
                                                                 <span className="text-[9px] line-through text-gray-400 font-semibold whitespace-nowrap">
                                                                     Rp {t.price.toLocaleString('id-ID')}
                                                                 </span>
                                                             )}
                                                             <span className="font-extrabold text-xs sm:text-sm text-[#5c3316] whitespace-nowrap">
                                                                 Rp {price.toLocaleString('id-ID')}
                                                             </span>
                                                         </div>
                                                         <button
                                                             type="button"
                                                             onClick={(e) => {
                                                                 e.stopPropagation()
                                                                 addToCart(t, 'treatment')
                                                             }}
                                                             className="w-7 h-7 rounded-lg bg-pink-50 hover:bg-ayumi-primary text-ayumi-primary hover:text-white flex items-center justify-center font-black text-xs border border-pink-200/80 transition-all shrink-0 shadow-xs cursor-pointer"
                                                             title="Tambah ke keranjang"
                                                         >
                                                             +
                                                         </button>
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
                                                className="bg-white p-3 rounded-xl border border-gray-200 shadow-xs flex flex-col justify-between hover:border-amber-400 hover:shadow-sm transition-all cursor-pointer group relative"
                                            >
                                                <div className="space-y-1 mb-2">
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border inline-block ${
                                                        p.quantity > 5 
                                                            ? 'bg-amber-50 text-amber-800 border-amber-200' 
                                                            : p.quantity > 0 
                                                                ? 'bg-rose-50 text-rose-700 border-rose-200' 
                                                                : 'bg-gray-100 text-gray-500 border-gray-200'
                                                    }`}>
                                                        Stok: {p.quantity}
                                                    </span>
                                                    <h4 className="font-bold text-xs sm:text-sm text-gray-900 line-clamp-2 leading-snug group-hover:text-amber-900 transition-colors">
                                                        {p.name}
                                                    </h4>
                                                </div>

                                                <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-auto gap-1.5">
                                                    <span className="font-extrabold text-xs sm:text-sm text-amber-900 whitespace-nowrap">
                                                        Rp {p.price.toLocaleString('id-ID')}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            addToCart(p, 'product')
                                                        }}
                                                        className="w-7 h-7 rounded-lg bg-amber-50 hover:bg-amber-600 text-amber-800 hover:text-white flex items-center justify-center font-black text-xs border border-amber-200/80 transition-all shrink-0 shadow-xs cursor-pointer"
                                                        title="Tambah ke keranjang"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    }

                                    {activeTab === 'coupon' && coupons
                                        .filter(c => !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                        .map(c => (
                                            <div
                                                key={c.id}
                                                onClick={() => addToCart(c, 'coupon')}
                                                className="bg-white p-3 rounded-xl border border-gray-200 shadow-xs flex flex-col justify-between hover:border-pink-300 hover:shadow-sm transition-all cursor-pointer group relative"
                                            >
                                                <div className="space-y-1 mb-2">
                                                    <span className="bg-pink-50 text-pink-700 border border-pink-200 text-[9px] font-extrabold px-1.5 py-0.5 rounded inline-block">
                                                        Paket Kupon
                                                    </span>
                                                    <h4 className="font-bold text-xs sm:text-sm text-gray-900 line-clamp-2 leading-snug group-hover:text-ayumi-primary transition-colors">
                                                        {c.name}
                                                    </h4>
                                                </div>

                                                <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-auto gap-1.5">
                                                    <span className="font-extrabold text-xs sm:text-sm text-[#5c3316] whitespace-nowrap">
                                                        Rp {c.price.toLocaleString('id-ID')}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            addToCart(c, 'coupon')
                                                        }}
                                                        className="w-7 h-7 rounded-lg bg-pink-50 hover:bg-ayumi-primary text-ayumi-primary hover:text-white flex items-center justify-center font-black text-xs border border-pink-200/80 transition-all shrink-0 shadow-xs cursor-pointer"
                                                        title="Tambah ke keranjang"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    }
                                </div>
                            )}
                        </div>
                    </div>
                )}

            </div>


            {/* RIGHT PANE: CART & CHECKOUT */}
            <div className="w-full lg:w-2/5 flex flex-col bg-white rounded-3xl shadow-lg border border-gray-100 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-ayumi-secondary to-ayumi-primary"></div>
                
                {/* Patient Selector */}
                <div className="p-5 border-b border-gray-100 pt-6 bg-white">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Pelanggan (Wajib Diisi)</label>
                    {selectedPatient ? (
                        <div className="flex justify-between items-center bg-pink-50/50 p-4.5 rounded-2xl border border-pink-100/60 shadow-sm relative overflow-hidden transition-all">
                            <div className="flex items-center gap-3">
                                {/* Initial Avatar */}
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-ayumi-primary to-rose-400 flex items-center justify-center text-white font-black text-base shadow-inner flex-shrink-0">
                                    {(selectedPatient.full_name?.charAt(0) || '?').toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                    <p className="font-extrabold text-gray-900 leading-tight text-base truncate">{selectedPatient.full_name}</p>
                                    <p className="text-xs text-gray-500 mt-1  tracking-tight">{selectedPatient.whatsapp || 'No HP tidak ada'}</p>
                                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                        {/* CRM Badge */}
                                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border shadow-sm ${
                                            (selectedPatientDetails?.crmStatus === 'Active') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                            (selectedPatientDetails?.crmStatus === 'Warm') ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                            (selectedPatientDetails?.crmStatus === 'Dormant') ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                            'bg-blue-50 text-blue-700 border-blue-200'
                                        }`}>
                                            {selectedPatientDetails?.crmStatus || 'New'}
                                        </span>
                                        {/* Transaction Count Badge */}
                                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-600 shadow-sm">
                                            Transaksi ke-{selectedPatientDetails ? (selectedPatientDetails.transactionCount || 0) + 1 : '...'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <button 
                                type="button"
                                onClick={() => {
                                    setSelectedPatient(null)
                                    setSelectedPatientDetails(null)
                                    setCart([])
                                    if (pendingBills.length > 0) {
                                        setLeftPanelTab('pending')
                                    }
                                }} 
                                className="text-gray-400 hover:text-rose-600 p-2 bg-white hover:bg-rose-50 rounded-xl transition-all border border-gray-100 shadow-sm flex-shrink-0"
                                title="Ganti Pasien"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    ) : isQuickAddInlineOpen ? (
                        /* Inline Quick Add Patient Form */
                        <form onSubmit={handleQuickAddPatient} className="bg-pink-50/30 p-4.5 rounded-2xl border border-pink-100/60 shadow-sm space-y-3.5 transition-all">
                            <div className="flex justify-between items-center">
                                <h3 className="font-extrabold text-xs text-ayumi-secondary uppercase tracking-wider">Tambah Pasien Cepat</h3>
                                <button 
                                    type="button" 
                                    onClick={() => {
                                        setIsQuickAddInlineOpen(false)
                                        setQuickAddError('')
                                    }} 
                                    className="text-xs text-gray-400 hover:text-gray-600 font-bold"
                                >
                                    Batal
                                </button>
                            </div>
                            
                            {quickAddError && (
                                <p className="text-[11px] text-red-500 font-semibold">{quickAddError}</p>
                            )}

                            <div className="space-y-2.5">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Nama Lengkap</label>
                                    <input 
                                        type="text" 
                                        placeholder="Nama Lengkap Pasien"
                                        value={quickAddForm.full_name}
                                        onChange={(e) => setQuickAddForm(prev => ({ ...prev, full_name: e.target.value }))}
                                        className="input-ayumi w-full bg-white text-xs"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">No. WhatsApp</label>
                                    <input 
                                        type="tel" 
                                        placeholder="Contoh: 08123456789"
                                        value={quickAddForm.whatsapp}
                                        onChange={(e) => setQuickAddForm(prev => ({ ...prev, whatsapp: e.target.value }))}
                                        className="input-ayumi w-full bg-white text-xs"
                                        required
                                    />
                                </div>
                            </div>

                            <button 
                                type="submit" 
                                disabled={isQuickAdding}
                                className="w-full bg-ayumi-primary hover:bg-ayumi-primary-hover text-white text-xs font-bold py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md shadow-pink-500/20"
                            >
                                {isQuickAdding ? (
                                    <span className="animate-pulse">Menyimpan...</span>
                                ) : (
                                    <>
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                                        Simpan & Pilih Pasien
                                    </>
                                )}
                            </button>
                        </form>
                    ) : (
                        <div className="relative">
                            <div className="relative flex items-center">
                                <span className="absolute left-3 text-gray-400">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                </span>
                                <input
                                    type="text"
                                    placeholder="Cari Nama Pasien / No. WA..."
                                    value={searchPatientQuery}
                                    onChange={(e) => {
                                        setSearchPatientQuery(e.target.value)
                                        setIsPatientDropdownOpen(true)
                                    }}
                                    onFocus={() => setIsPatientDropdownOpen(true)}
                                    className="input-ayumi w-full pl-9 bg-gray-50/80 border-gray-200/80 focus:bg-white text-sm"
                                />
                                {searchPatientQuery && (
                                    <button 
                                        type="button"
                                        onClick={() => setSearchPatientQuery('')} 
                                        className="absolute right-3 text-gray-400 hover:text-gray-600"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                )}
                            </div>
                            {isPatientDropdownOpen && (
                                <div className="absolute z-20 w-full mt-1.5 bg-white border border-gray-100 shadow-xl rounded-2xl max-h-64 overflow-y-auto custom-scrollbar divide-y divide-gray-50">
                                    {searchPatientQuery.trim().length < 2 ? (
                                        <div className="p-3.5 text-center text-xs text-gray-400">
                                            Ketik minimal 2 karakter untuk mencari pasien...
                                        </div>
                                    ) : isSearchingPatient ? (
                                        <div className="p-4 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
                                            <div className="w-3.5 h-3.5 border-2 border-ayumi-primary border-t-transparent rounded-full animate-spin"></div>
                                            <span>Mencari data pasien...</span>
                                        </div>
                                    ) : patientSearchResults.length > 0 ? (
                                        patientSearchResults.map(p => (
                                            <div 
                                                key={p.id} 
                                                onClick={() => handleSelectPatient(p)}
                                                className="px-4.5 py-3 hover:bg-pink-50/40 cursor-pointer transition-colors flex items-center justify-between group"
                                            >
                                                <div className="min-w-0">
                                                    <p className="font-bold text-gray-800 text-sm truncate">{p.full_name}</p>
                                                    <p className="text-xs text-gray-400 mt-0.5">{p.whatsapp || 'No HP tidak ada'}</p>
                                                </div>
                                                <span className="text-[10px] text-ayumi-primary font-bold opacity-0 group-hover:opacity-100 transition-opacity">Pilih →</span>
                                            </div>
                                        ))
                                    ) : !isSearchingPatient && hasSearchedPatient && patientSearchResults.length === 0 ? (
                                        <div className="p-3.5 text-center">
                                            <p className="text-xs text-gray-500 mb-2">Tidak ditemukan pasien dengan nama / WA "{searchPatientQuery}".</p>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setQuickAddForm({ full_name: searchPatientQuery, whatsapp: '' })
                                                    setIsQuickAddInlineOpen(true)
                                                    setIsPatientDropdownOpen(false)
                                                }}
                                                className="w-full bg-pink-50 hover:bg-pink-100 text-ayumi-primary text-xs font-bold py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                                + Daftarkan "{searchPatientQuery}" Sebagai Pasien Baru
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-5 pb-24 custom-scrollbar bg-gray-50/30">
                    {cart.length === 0 ? (
                        !selectedPatient ? (
                            <div className="h-full flex flex-col items-center justify-center text-center p-4 md:p-6 gap-4">
                                <div className="w-20 h-20 bg-pink-50 rounded-full flex items-center justify-center shadow-inner animate-pulse">
                                    <svg className="w-10 h-10 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                </div>
                                <div>
                                    <p className="text-sm font-extrabold text-gray-800 leading-snug">Pilih Pelanggan Dahulu</p>
                                    <p className="text-xs text-gray-400 mt-1 max-w-[220px] mx-auto leading-relaxed">Cari nama atau nomor WhatsApp pasien di atas untuk memulai transaksi</p>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center p-4 md:p-6 gap-4">
                                <div className="w-20 h-20 bg-purple-50 rounded-full flex items-center justify-center shadow-inner">
                                    <svg className="w-10 h-10 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                                </div>
                                <div>
                                    <p className="text-sm font-extrabold text-gray-800 leading-snug">Keranjang Belum Diisi</p>
                                    <p className="text-xs text-gray-400 mt-1 max-w-[220px] mx-auto leading-relaxed">Tambahkan perawatan, produk skincare, atau kupon paket melalui tombol '+ Tambah Item' di bawah</p>
                                </div>
                            </div>
                        )
                    ) : (
                        <div className="space-y-4">
                            {cart.map((item, idx) => (
                                <div key={idx} className="flex flex-col bg-white p-4.5 rounded-2xl border border-gray-100 shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:border-pink-200 hover:shadow-md transition-all duration-200">
                                    {/* Top row: badge, name & delete button */}
                                    <div className="flex items-start justify-between gap-2 mb-3">
                                        <div className="flex flex-col gap-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className={`text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md flex items-center shadow-xs ${
                                                    item.item_type === 'treatment' 
                                                        ? 'bg-purple-50 text-purple-600 border border-purple-100/70' 
                                                        : item.item_type === 'product'
                                                        ? 'bg-orange-50 text-orange-600 border border-orange-100/70'
                                                        : 'bg-pink-50 text-pink-600 border border-pink-100/70'
                                                }`}>
                                                    {item.item_type === 'treatment' ? 'Treatment' : item.item_type === 'product' ? 'Produk Fisik' : 'Kupon Paket'}
                                                </span>
                                            </div>
                                            <p className="font-extrabold text-gray-800 text-sm leading-tight mt-0.5 tracking-tight break-words">{item.name}</p>

                                            {/* Active Coupon Banner & Toggle in Cart Item */}
                                            {item.item_type === 'treatment' && (
                                                <div className="mt-1.5">
                                                    {item.is_using_coupon ? (
                                                        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-2 rounded-xl text-xs flex items-center justify-between gap-2 shadow-sm">
                                                            <div className="flex items-center gap-1.5 font-bold">
                                                                <span>🎟️</span>
                                                                <span className="text-[11px]">Kupon: <strong>{item.coupon_package_name}</strong> (Sisa {item.remaining_sessions} Sesi)</span>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleCartItemCoupon(item.id)}
                                                                className="text-[10px] font-extrabold bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-lg transition-colors shrink-0"
                                                            >
                                                                Bayar Normal
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        (() => {
                                                            const availableCoupon = patientActiveCoupons.find(c => c.treatment_id === item.id && c.remaining_sessions > 0)
                                                            if (availableCoupon) {
                                                                return (
                                                                    <div className="bg-amber-50 border border-amber-200 text-amber-900 p-2 rounded-xl text-xs flex items-center justify-between gap-2 shadow-sm">
                                                                        <div className="font-semibold text-[11px]">
                                                                            💡 Ada Kupon: <strong className="font-extrabold">{availableCoupon.patient_coupons?.coupon_packages?.name}</strong> (Sisa {availableCoupon.remaining_sessions} Sesi)
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => toggleCartItemCoupon(item.id)}
                                                                            className="text-[10px] font-extrabold bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg shadow-sm transition-all shrink-0"
                                                                        >
                                                                            Pakai Kupon (Rp 0)
                                                                        </button>
                                                                    </div>
                                                                )
                                                            }
                                                            return null
                                                        })()
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <button 
                                            type="button"
                                            onClick={() => removeFromCart(item.id, item.item_type)}
                                            className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-50 text-gray-400 hover:bg-rose-100 hover:text-rose-600 hover:scale-105 hover:border-rose-200 border border-transparent shadow-sm transition-all duration-150 flex-shrink-0"
                                            title="Hapus dari keranjang"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>

                                    {/* Collapsible toggle button */}
                                    <div className="flex justify-between items-center mb-1.5">
                                        <button 
                                            type="button"
                                            onClick={() => setExpandedCartItem(prev => prev === `${item.id}-${item.item_type}` ? null : `${item.id}-${item.item_type}`)}
                                            className="text-[10px] font-extrabold text-ayumi-primary hover:text-pink-700 hover:underline flex items-center gap-1 transition-all"
                                        >
                                            {expandedCartItem === `${item.id}-${item.item_type}` ? (
                                                <>
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 15l7-7 7 7" /></svg>
                                                    Sembunyikan Diskon & Harga
                                                </>
                                            ) : (
                                                <>
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                                                    Atur Diskon & Harga (Rp {(item.price || 0).toLocaleString('id-ID')})
                                                </>
                                            )}
                                        </button>
                                    </div>

                                            {/* 2x2 Interactive Price Grid (Collapsible) */}
                                            {expandedCartItem === `${item.id}-${item.item_type}` && (
                                                <div className="grid grid-cols-2 gap-2 mt-1 mb-2 pt-2 border-t border-dashed border-gray-150 animate-fadeIn duration-200">
                                                    {/* Harga Awal */}
                                                    <div className="bg-gray-50/50 p-2 rounded-xl border border-gray-100 focus-within:border-pink-200 focus-within:bg-white transition-all">
                                                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider block mb-0.5">Harga Awal</label>
                                                        <div className="relative flex items-center">
                                                            <span className="text-[10px] text-gray-400 font-bold mr-1">Rp</span>
                                                            <input 
                                                                type="number" 
                                                                value={!item.original_price ? '' : item.original_price} 
                                                                onFocus={(e) => e.target.select()}
                                                                placeholder="0"
                                                                onChange={(e) => handleCartItemOriginalPriceChange(item.id, item.item_type, e.target.value)}
                                                                className="w-full text-xs font-bold bg-transparent border-none outline-none text-gray-700 p-0 focus:ring-0 focus:outline-none"
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Diskon (%) */}
                                                    <div className="bg-gray-50/50 p-2 rounded-xl border border-gray-100 focus-within:border-pink-200 focus-within:bg-white transition-all">
                                                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider block mb-0.5">Diskon (%)</label>
                                                        <div className="relative flex items-center justify-between">
                                                            <input 
                                                                type="number" 
                                                                value={!item.discount_percent ? '' : item.discount_percent} 
                                                                onFocus={(e) => e.target.select()}
                                                                placeholder="0"
                                                                onChange={(e) => handleCartItemDiscountChange(item.id, item.item_type, e.target.value)}
                                                                className="w-full text-xs font-bold bg-transparent border-none outline-none text-gray-700 p-0 text-right pr-4 focus:ring-0 focus:outline-none"
                                                                min="0"
                                                                max="100"
                                                            />
                                                            <span className="absolute right-0 text-[10px] text-gray-400 font-bold">%</span>
                                                        </div>
                                                    </div>

                                                    {/* Potongan (Rp) */}
                                                    <div className="bg-gray-50/50 p-2 rounded-xl border border-gray-100 focus-within:border-pink-200 focus-within:bg-white transition-all">
                                                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider block mb-0.5">Potongan (Rp)</label>
                                                        <div className="relative flex items-center">
                                                            <span className="text-[10px] text-gray-400 font-bold mr-1">Rp</span>
                                                            {(() => {
                                                                const potNom = Math.max(0, (item.original_price || 0) - (item.price || 0))
                                                                return (
                                                                    <input 
                                                                        type="number" 
                                                                        value={!potNom ? '' : potNom} 
                                                                        onFocus={(e) => e.target.select()}
                                                                        placeholder="0"
                                                                        onChange={(e) => handleCartItemDiscountNominalChange(item.id, item.item_type, e.target.value)}
                                                                        className="w-full text-xs font-bold bg-transparent border-none outline-none text-gray-700 p-0 text-right focus:ring-0 focus:outline-none"
                                                                        min="0"
                                                                    />
                                                                )
                                                            })()}
                                                        </div>
                                                    </div>

                                                    {/* Harga Net */}
                                                    <div className="bg-pink-50/30 p-2 rounded-xl border border-pink-100/50 focus-within:border-pink-300 focus-within:bg-white transition-all">
                                                        <label className="text-[9px] font-black uppercase text-pink-600/70 tracking-wider block mb-0.5">Harga Net</label>
                                                        <div className="relative flex items-center">
                                                            <span className="text-[10px] text-ayumi-primary font-bold mr-1">Rp</span>
                                                            <input 
                                                                type="number" 
                                                                value={!item.price ? '' : item.price} 
                                                                onFocus={(e) => e.target.select()}
                                                                placeholder="0"
                                                                onChange={(e) => handleCartItemPriceChange(item.id, item.item_type, e.target.value)}
                                                                className="w-full text-xs font-black bg-transparent border-none outline-none text-ayumi-primary p-0 focus:ring-0 focus:outline-none"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                    {/* Bottom row: quantity controls & item subtotal */}
                                    <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-100">
                                        <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-1 border border-gray-100">
                                            <button 
                                                onClick={() => updateCartQty(item.id, item.item_type, -1)} 
                                                className="w-6 h-6 flex items-center justify-center text-gray-500 bg-white rounded-lg shadow-sm hover:bg-gray-100 hover:text-gray-800 transition-all font-black text-sm"
                                            >-</button>
                                            <span className="font-extrabold text-xs w-6 text-center text-gray-700">{item.quantity}</span>
                                            <button 
                                                onClick={() => updateCartQty(item.id, item.item_type, 1)} 
                                                className="w-6 h-6 flex items-center justify-center text-gray-500 bg-white rounded-lg shadow-sm hover:bg-gray-100 hover:text-gray-800 transition-all font-black text-sm"
                                            >+</button>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-[8px] font-black uppercase text-gray-400 tracking-wider block">Subtotal</span>
                                            <span className=" font-black text-sm text-ayumi-secondary">
                                                Rp {((item.price || 0) * item.quantity).toLocaleString('id-ID')}
                                            </span>
                                        </div>
                                    </div>
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
                            <span className=" font-bold">Rp {subtotal.toLocaleString('id-ID')}</span>
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
                                    value={(!discountValue || discountValue === 0 || discountValue === '0') ? '' : discountValue}
                                    onFocus={(e) => e.target.select()}
                                    placeholder="0"
                                    onChange={(e) => setDiscountValue(e.target.value)}
                                    className="input-ayumi py-1 px-3 text-right flex-1 bg-gray-50 "
                                    min="0"
                                />
                            </div>
                        </div>

                        {discountAmount > 0 && (
                            <div className="flex justify-between text-sm text-red-500 font-semibold">
                                <span>Potongan</span>
                                <span className="">- Rp {discountAmount.toLocaleString('id-ID')}</span>
                            </div>
                        )}

                        {paymentMethod === 'qris' && (
                            <div className="flex justify-between text-sm text-blue-700 font-semibold bg-blue-50/70 p-2.5 rounded-xl border border-blue-100/80 animate-fadeIn">
                                <span className="flex items-center gap-1.5">
                                    <span>📱 Biaya Layanan QRIS (0,3%)</span>
                                </span>
                                <span className=" font-bold">+ Rp {qrisFee.toLocaleString('id-ID')}</span>
                            </div>
                        )}

                        <div className="flex justify-between items-baseline border-t border-gray-100 pt-3">
                            <span className="font-black text-gray-800 text-sm">TOTAL BAYAR</span>
                            <span className="font-extrabold text-2xl text-ayumi-secondary  tracking-tight">Rp {total.toLocaleString('id-ID')}</span>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {cart.some(item => item.item_type === 'treatment' && !item.treatment_record_id) && (
                            <div>
                                <label className="block text-[10px] font-extrabold text-ayumi-primary uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <span>👩‍⚕️</span> Terapis Tindakan <span className="text-red-500 font-black">*</span>
                                </label>
                                <select
                                    value={selectedTherapistId}
                                    onChange={(e) => setSelectedTherapistId(e.target.value)}
                                    className="w-full input-ayumi text-xs font-bold bg-white focus:border-ayumi-primary"
                                >
                                    <option value="">-- Pilih Terapis Tindakan --</option>
                                    {therapists.map(t => (
                                        <option key={t.id} value={t.id}>{t.full_name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div>
                            <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-2">Metode Pembayaran</label>
                            <div className="grid grid-cols-5 gap-1.5">
                                {[
                                    { id: 'cash', label: 'Cash', icon: '💵' },
                                    { id: 'transfer', label: 'Bank', icon: '🏦' },
                                    { id: 'qris', label: 'QRIS (+0.3%)', icon: '📱' },
                                    { id: 'debit', label: 'Debit', icon: '💳' },
                                    { id: 'credit', label: 'Kredit', icon: '💳' }
                                ].map(pm => (
                                    <button
                                        key={pm.id}
                                        type="button"
                                        onClick={() => setPaymentMethod(pm.id)}
                                        className={`flex flex-col items-center justify-center py-2 px-0.5 rounded-xl border text-[10px] font-extrabold transition-all ${
                                            paymentMethod === pm.id
                                                ? 'bg-pink-50 border-ayumi-primary text-ayumi-primary shadow-sm scale-105'
                                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                        }`}
                                    >
                                        <span className="text-base mb-0.5">{pm.icon}</span>
                                        <span className="truncate w-full text-center">{pm.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button 
                            type="button"
                            onClick={handleCheckout}
                            disabled={isProcessing || cart.length === 0 || !selectedBranch}
                            className="w-full bg-ayumi-primary hover:bg-ayumi-primary-hover disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none text-white py-4 rounded-2xl text-base font-black tracking-wider flex justify-center items-center gap-2.5 shadow-lg shadow-pink-500/20 active:scale-[0.99] transition-all"
                        >
                            {isProcessing ? (
                                <span className="animate-pulse">Memproses Pembayaran...</span>
                            ) : (
                                <>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
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
        <Suspense fallback={<div className="p-5 md:p-8 text-center text-ayumi-text-muted animate-pulse">Memuat antarmuka kasir...</div>}>
            <PosPageContent />
        </Suspense>
    )
}
