'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter, useSearchParams } from 'next/navigation'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import BranchFilter from '@/components/ui/BranchFilter'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton'
import { usePatientSearch } from '@/hooks/usePatientSearch'
import { validatePatientData } from '@/lib/patientValidation'
import HorizontalCategoryRow from '@/components/pos/HorizontalCategoryRow'
import ItemVariantModal from '@/components/pos/ItemVariantModal'
import { getItemInitials, getItemCategory, getProductVariants, DEFAULT_CATEGORY_ORDER } from '@/lib/productVariants'

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
    const [categories, setCategories] = useState([])
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
    } = usePatientSearch({ debounceMs: 150, limit: 50 })

    // UI State
    const [activeTab, setActiveTab] = useState('treatment') // 'treatment' | 'product' | 'coupon' | 'all'
    const [searchQuery, setSearchQuery] = useState('')
    const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false)
    const [isPendingModalOpen, setIsPendingModalOpen] = useState(false)
    const [leftPanelTab, setLeftPanelTab] = useState('pending')
    const [expandedCartItem, setExpandedCartItem] = useState(null)
    const [patientActiveCoupons, setPatientActiveCoupons] = useState([])

    // Item Variant & Quantity Modal State
    const [selectedCatalogItem, setSelectedCatalogItem] = useState(null)
    const [selectedItemType, setSelectedItemType] = useState('product') // 'treatment' | 'product' | 'coupon'
    const [isItemModalOpen, setIsItemModalOpen] = useState(false)

    // Quick Add Patient State
    const [quickAddForm, setQuickAddForm] = useState({ full_name: '', whatsapp: '' })
    const [isQuickAdding, setIsQuickAdding] = useState(false)
    const [quickAddError, setQuickAddError] = useState('')
    const [quickAddConflict, setQuickAddConflict] = useState(null)
    const [selectedPatientDetails, setSelectedPatientDetails] = useState(null)
    const [isQuickAddInlineOpen, setIsQuickAddInlineOpen] = useState(false)

    // Cart State
    const [cart, setCart] = useState([]) // { id, item_type, name, price, quantity, maxQuantity (for products), therapist_id }
    const [selectedPatient, setSelectedPatient] = useState(null)
    const [discountType, setDiscountType] = useState('nominal') // 'nominal' | 'percent'
    const [discountValue, setDiscountValue] = useState(0)
    const [paymentMethod, setPaymentMethod] = useState('cash')
    const [cashReceived, setCashReceived] = useState('')
    const [splitAmounts, setSplitAmounts] = useState({ cash: '', transfer: '', qris: '', debit: '', credit: '' })
    const [notes, setNotes] = useState('')
    const [isProcessing, setIsProcessing] = useState(false)

    // Held Transactions State (Tahan Draft Transaksi)
    const [heldTransactions, setHeldTransactions] = useState([])
    const [isHeldModalOpen, setIsHeldModalOpen] = useState(false)

    // Load held drafts and restore active draft on mount
    useEffect(() => {
        try {
            const savedHeld = localStorage.getItem('ayumi_pos_held_transactions')
            if (savedHeld) {
                setHeldTransactions(JSON.parse(savedHeld))
            }
            const activeDraft = localStorage.getItem('ayumi_pos_active_draft')
            if (activeDraft) {
                const parsed = JSON.parse(activeDraft)
                if (parsed.cart?.length > 0 || parsed.selectedPatient) {
                    setCart(parsed.cart || [])
                    setSelectedPatient(parsed.selectedPatient || null)
                    setSelectedPatientDetails(parsed.selectedPatientDetails || null)
                    setDiscountType(parsed.discountType || 'nominal')
                    setDiscountValue(parsed.discountValue || 0)
                    setNotes(parsed.notes || '')
                    setSelectedTherapistId(parsed.selectedTherapistId || '')
                }
            }
        } catch (err) {
            console.error('Error loading saved drafts from storage:', err)
        }
    }, [])

    // Auto-save active draft to localStorage
    useEffect(() => {
        try {
            if (cart.length > 0 || selectedPatient) {
                localStorage.setItem('ayumi_pos_active_draft', JSON.stringify({
                    cart,
                    selectedPatient,
                    selectedPatientDetails,
                    discountType,
                    discountValue,
                    notes,
                    selectedTherapistId,
                    timestamp: new Date().toISOString()
                }))
            } else {
                localStorage.removeItem('ayumi_pos_active_draft')
            }
        } catch (err) {
            console.error('Error auto-saving active cart:', err)
        }
    }, [cart, selectedPatient, selectedPatientDetails, discountType, discountValue, notes, selectedTherapistId])

    // Handler to Hold current active transaction
    const handleHoldTransaction = () => {
        if (cart.length === 0 && !selectedPatient) {
            alert('Tidak ada data pasien atau item belanja di keranjang yang bisa ditahan!')
            return
        }

        const newHeld = {
            id: 'held_' + Date.now(),
            patient: selectedPatient,
            patientDetails: selectedPatientDetails,
            cart: [...cart],
            discountType,
            discountValue,
            notes,
            selectedTherapistId,
            heldAt: new Date().toISOString(),
            totalAmount: total
        }

        const updated = [newHeld, ...heldTransactions]
        setHeldTransactions(updated)
        try {
            localStorage.setItem('ayumi_pos_held_transactions', JSON.stringify(updated))
            localStorage.removeItem('ayumi_pos_active_draft')
        } catch (e) {
            console.error(e)
        }

        // Reset active cart
        setCart([])
        setSelectedPatient(null)
        setSelectedPatientDetails(null)
        setDiscountValue(0)
        setNotes('')
        setCashReceived('')
        setSelectedTherapistId('')

        toast.success(`Transaksi ${newHeld.patient?.full_name ? 'atas nama "' + newHeld.patient.full_name + '"' : ''} berhasil ditahan!`)
    }

    // Handler to restore a held transaction
    const handleRestoreHeldTransaction = (heldItem) => {
        if (cart.length > 0 || selectedPatient) {
            const confirmSwap = confirm('Keranjang kasir saat ini sedang terisi. Apakah Anda ingin menahan transaksi saat ini terlebih dahulu dan membuka draft ini?')
            if (confirmSwap) {
                handleHoldTransaction()
            }
        }

        setSelectedPatient(heldItem.patient || null)
        setSelectedPatientDetails(heldItem.patientDetails || null)
        setCart(heldItem.cart || [])
        setDiscountType(heldItem.discountType || 'nominal')
        setDiscountValue(heldItem.discountValue || 0)
        setNotes(heldItem.notes || '')
        setSelectedTherapistId(heldItem.selectedTherapistId || '')
        setCashReceived('')

        // Remove from held list
        const remaining = heldTransactions.filter(h => h.id !== heldItem.id)
        setHeldTransactions(remaining)
        try {
            localStorage.setItem('ayumi_pos_held_transactions', JSON.stringify(remaining))
        } catch (e) {
            console.error(e)
        }

        setIsHeldModalOpen(false)
        toast.success(`Draft transaksi ${heldItem.patient?.full_name || ''} berhasil dibuka kembali!`)
    }

    // Handler to delete a held draft
    const handleDeleteHeldTransaction = (heldId, e) => {
        e?.stopPropagation()
        if (confirm('Yakin ingin menghapus draft transaksi tertahan ini?')) {
            const remaining = heldTransactions.filter(h => h.id !== heldId)
            setHeldTransactions(remaining)
            try {
                localStorage.setItem('ayumi_pos_held_transactions', JSON.stringify(remaining))
            } catch (err) {
                console.error(err)
            }
            toast.success('Draft berhasil dihapus.')
        }
    }

    // Handler to reset current active cart
    const handleResetCart = () => {
        if (confirm('Kosongkan keranjang dan mulai transaksi baru?')) {
            setCart([])
            setSelectedPatient(null)
            setSelectedPatientDetails(null)
            setDiscountValue(0)
            setNotes('')
            setCashReceived('')
            setSelectedTherapistId('')
            try {
                localStorage.removeItem('ayumi_pos_active_draft')
            } catch (err) {
                console.error(err)
            }
            toast.success('Keranjang berhasil dikosongkan.')
        }
    }

    async function fetchInitialData() {
        setIsLoading(true)
        
        // Fetch User and Master Data in parallel (eliminate waterfall lag)
        const [userRes, brRes, trRes, cpRes, thRes, catRes] = await Promise.all([
            supabase.auth.getUser(),
            supabase.from('branches').select('id, name').eq('is_active', true),
            supabase.from('treatments').select('*, treatment_categories(id, name, sort_order)').eq('is_active', true).order('name', { ascending: true }),
            supabase.from('coupon_packages').select('*').eq('is_active', true).order('name', { ascending: true }),
            supabase.from('users').select('id, full_name').eq('role', 'therapist').eq('is_active', true).order('full_name'),
            supabase.from('treatment_categories').select('*').eq('is_active', true).order('sort_order', { ascending: true })
        ])

        const user = userRes.data?.user
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
        
        if (brRes.data) setBranches(brRes.data)
        if (trRes.data) setTreatments(trRes.data)
        if (cpRes.data) setCoupons(cpRes.data)
        if (thRes.data) setTherapists(thRes.data)
        if (catRes.data) setCategories(catRes.data)

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
                    treatment_record_items(notes, treatment_id, price_at_time, discount_percent, original_price, commission_percent, treatments(name, price, commission_percent))
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
                products (id, name, description, price, is_active)
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
            // Status 'active' tidak pernah berubah sendiri saat masa berlaku habis,
            // jadi tanggal kedaluwarsa harus diperiksa terpisah agar kupon lewat tempo tidak bisa ditukar.
            .gt('expired_at', new Date().toISOString())

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
        setQuickAddError('')
        setQuickAddConflict(null)

        // 1. Validasi Pemilihan Cabang
        if (!selectedBranch) {
            setQuickAddError('Pilih cabang klinik terlebih dahulu di bagian atas sebelum mendaftarkan pasien baru.')
            return
        }

        // 2. Centralized Validation
        const { isValid, errors, cleanPayload } = validatePatientData({
            full_name: quickAddForm.full_name,
            whatsapp: quickAddForm.whatsapp,
            branch_id: selectedBranch
        })

        if (!isValid) {
            const firstErr = Object.values(errors)[0]
            setQuickAddError(firstErr)
            return
        }

        setIsQuickAdding(true)

        try {
            // 3. Validasi WhatsApp Unik
            const { data: existingWa } = await supabase
                .from('patients')
                .select('id, full_name, whatsapp, branch_id, branches(name)')
                .eq('whatsapp', cleanPayload.whatsapp)
                .maybeSingle()
                
            if (existingWa) {
                const { data: tr } = await supabase
                    .from('treatment_records')
                    .select('treatment_date')
                    .eq('patient_id', existingWa.id)
                    .order('treatment_date', { ascending: false })
                    .limit(1)

                setQuickAddConflict({
                    ...existingWa,
                    lastVisit: tr && tr.length > 0 ? tr[0].treatment_date : null
                })
                setIsQuickAdding(false)
                return
            }

            // 4. Warning Nama Duplikat jika ada nama persis
            const { data: existingNames } = await supabase
                .from('patients')
                .select('id, whatsapp')
                .ilike('full_name', cleanPayload.full_name)
                .limit(1)

            if (existingNames && existingNames.length > 0) {
                const proceed = window.confirm(`PERINGATAN: Pasien dengan nama "${cleanPayload.full_name}" sudah terdaftar (WA: ${existingNames[0].whatsapp || '-'}).\n\nYakin ingin tetap menambahkan sebagai pasien baru?`)
                if (!proceed) {
                    setIsQuickAdding(false)
                    return
                }
            }

            // 5. Insert dengan branch_id & payload bersih
            const { data, error } = await supabase
                .from('patients')
                .insert([cleanPayload])
                .select()
                .single()

            if (error) throw error

            handleSelectPatient(data)
            setQuickAddForm({ full_name: '', whatsapp: '' })
            setQuickAddConflict(null)
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
                treatment_record_items(notes, treatment_id, price_at_time, discount_percent, original_price, commission_percent, treatments(name, price, commission_percent)),
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
        try {
            if (!bill) return

            if (bill.branch_id && bill.branch_id !== selectedBranch) {
                setSelectedBranch(bill.branch_id)
            }

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
            
            let newPackageItem = null
            const processedTreatments = []

            for (const item of (bill.treatment_record_items || [])) {
                const originalPrice = Number(item.treatments?.price) || Number(item.original_price) || Number(item.price_at_time) || 0
                const rawNotes = item.notes || ''

                const matchNewPkg = rawNotes.match(/\[KUPON_BARU:([^:]+):([^:]+):([^\]]+)\]/)
                const matchOldPkg = rawNotes.match(/\[KUPON_LAMA:([^:]+):([^\]]+)\]/)

                if (matchNewPkg) {
                    const [, pkgId, pkgName, pkgPrice] = matchNewPkg
                    const fallbackPkg = (coupons || []).find(p => p.id === pkgId || p.name?.toLowerCase() === pkgName?.toLowerCase())
                    const parsedPrice = Number(pkgPrice) || Number(fallbackPkg?.price) || 0

                    if (!newPackageItem) {
                        newPackageItem = {
                            id: pkgId || fallbackPkg?.id || 'new-coupon',
                            item_type: 'coupon',
                            name: `Paket Kupon: ${pkgName || fallbackPkg?.name || 'Paket'}`,
                            price: parsedPrice,
                            original_price: parsedPrice,
                            discount_percent: 0,
                            quantity: 1,
                            subtotal: parsedPrice,
                            commission_percent: 0,
                            treatment_record_id: bill.id,
                            is_new_coupon_package: true
                        }
                    }

                processedTreatments.push({
                    id: item.treatment_id,
                    item_type: 'treatment',
                    name: `${item.treatments?.name || 'Treatment'} (Sesi 1 dari Paket ${pkgName})`,
                    price: 0,
                    original_price: originalPrice,
                    discount_percent: 100,
                    quantity: 1,
                    subtotal: 0,
                    treatment_record_id: bill.id,
                    therapist_id: bill.performed_by || null,
                    commission_percent: item.commission_percent || item.treatments?.commission_percent || 5,
                    is_using_coupon: true,
                    is_first_session_of_new_coupon: true,
                    new_coupon_package_id: pkgId,
                    coupon_already_deducted: false,
                    used_coupon_item_id: null,
                    coupon_package_name: pkgName,
                    remaining_sessions: 0
                })
                continue
            }

            // Check if explicitly marked as old coupon or already deducted
            const alreadyUsedLog = existingCouponLogs.find(log => 
                log.patient_coupon_items?.treatment_id === item.treatment_id ||
                log.patient_coupon_item_id === item.treatment_id
            ) || (existingCouponLogs.length > 0 && (Number(item.price_at_time) === 0 || item.discount_percent === 100) ? existingCouponLogs[0] : null)

            if (alreadyUsedLog) {
                const cpItem = alreadyUsedLog.patient_coupon_items
                const pkgName = cpItem?.patient_coupons?.coupon_packages?.name || 'Paket Kupon'
                processedTreatments.push({
                    id: item.treatment_id,
                    item_type: 'treatment',
                    name: item.treatments?.name || 'Treatment',
                    price: 0,
                    original_price: originalPrice,
                    discount_percent: 100,
                    quantity: 1,
                    subtotal: 0,
                    treatment_record_id: bill.id,
                    therapist_id: bill.performed_by || null,
                    commission_percent: item.commission_percent || item.treatments?.commission_percent || 0,
                    is_using_coupon: true,
                    coupon_already_deducted: true,
                    used_coupon_item_id: alreadyUsedLog.patient_coupon_item_id,
                    coupon_package_name: pkgName,
                    remaining_sessions: cpItem?.remaining_sessions || 0
                })
                continue
            }

            // Check if matchOldPkg or active coupon available in activeCoupons
            let matchedCouponItem = null
            if (matchOldPkg) {
                const [, couponItemId] = matchOldPkg
                matchedCouponItem = activeCoupons.find(c => c.id === couponItemId)
            } else if (activeCoupons.length > 0) {
                matchedCouponItem = activeCoupons.find(c => c.treatment_id === item.treatment_id && c.remaining_sessions > 0)
            }

            if (matchedCouponItem) {
                const pkgName = matchedCouponItem.patient_coupons?.coupon_packages?.name || 'Paket Kupon'
                processedTreatments.push({
                    id: item.treatment_id,
                    item_type: 'treatment',
                    name: item.treatments?.name || 'Treatment',
                    price: 0,
                    original_price: originalPrice,
                    discount_percent: 100,
                    quantity: 1,
                    subtotal: 0,
                    treatment_record_id: bill.id,
                    therapist_id: bill.performed_by || null,
                    commission_percent: item.commission_percent || item.treatments?.commission_percent || 0,
                    is_using_coupon: true,
                    coupon_already_deducted: false,
                    used_coupon_item_id: matchedCouponItem.id,
                    coupon_package_name: pkgName,
                    remaining_sessions: matchedCouponItem.remaining_sessions
                })
                continue
            }

            // Otherwise regular treatment price
            const price = Number(item.price_at_time || 0)
            processedTreatments.push({
                id: item.treatment_id,
                item_type: 'treatment',
                name: item.treatments?.name || 'Treatment',
                price: price,
                original_price: originalPrice,
                discount_percent: item.discount_percent || 0,
                quantity: 1,
                subtotal: price,
                treatment_record_id: bill.id,
                therapist_id: bill.performed_by || null,
                commission_percent: item.commission_percent || item.treatments?.commission_percent || 0,
                is_using_coupon: false,
                coupon_already_deducted: false,
                used_coupon_item_id: null,
                coupon_package_name: '',
                remaining_sessions: 0
            })
        }

        const finalCart = newPackageItem ? [newPackageItem, ...processedTreatments] : processedTreatments
        setCart(finalCart)
        setSelectedTherapistId(bill.performed_by || 'worker')
        setIsPendingModalOpen(false)
        setLeftPanelTab('catalog')
        toast.success(`Tagihan ${bill.patients?.full_name || 'Pasien'} berhasil dimuat ke keranjang!`)
    } catch (err) {
        console.error('Error loading pending bill to cart:', err)
        toast.error('Gagal memuat tagihan: ' + (err.message || 'Terjadi kesalahan'))
    }
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

    // --- Item Variant Modal Handlers ---
    const handleOpenItemModal = (item, type) => {
        if (!selectedBranch) {
            alert('Silakan pilih cabang terlebih dahulu!')
            return
        }
        setSelectedCatalogItem(item)
        setSelectedItemType(type)
        setIsItemModalOpen(true)
    }

    const handleCloseItemModal = () => {
        setIsItemModalOpen(false)
        setSelectedCatalogItem(null)
    }

    const handleConfirmModalSelection = ({ item, itemType, quantity, selectedVariant, discountType, discountValue, basePrice, totalPrice }) => {
        const qty = Math.max(1, quantity || 1)
        let discountPercent = 0
        let customDiscountNominal = 0
        let unitPrice = basePrice

        if (discountValue > 0) {
            if (discountType === 'percent') {
                discountPercent = Math.min(100, Math.max(0, discountValue))
                unitPrice = Math.round(basePrice * (1 - discountPercent / 100))
            } else {
                customDiscountNominal = discountValue
                const discountPerUnit = Math.round(discountValue / qty)
                unitPrice = Math.max(0, basePrice - discountPerUnit)
                discountPercent = basePrice > 0 ? Math.round((discountPerUnit / basePrice) * 100) : 0
            }
        } else if (item.discount_percent > 0) {
            discountPercent = Number(item.discount_percent)
            unitPrice = Math.round(basePrice * (1 - discountPercent / 100))
        }

        // Check active coupon for treatment if no variant selected and itemType === 'treatment'
        let isUsingCoupon = false
        let usedCouponItemId = null
        let couponPackageName = ''
        let remainingSessions = 0

        if (itemType === 'treatment' && patientActiveCoupons.length > 0) {
            const match = patientActiveCoupons.find(c => c.treatment_id === item.id && c.remaining_sessions > 0)
            if (match) {
                isUsingCoupon = true
                usedCouponItemId = match.id
                couponPackageName = match.patient_coupons?.coupon_packages?.name || 'Paket Kupon'
                remainingSessions = match.remaining_sessions
                unitPrice = 0
                discountPercent = 100
            }
        }

        const cartItemId = selectedVariant 
            ? `${item.id}_${selectedVariant.name.replace(/[^a-zA-Z0-9]/g, '_')}`
            : item.id

        const cartItemName = selectedVariant
            ? `${item.name} (${selectedVariant.name})`
            : item.name

        setCart(prev => {
            const existingIdx = prev.findIndex(ci => ci.id === cartItemId && ci.item_type === itemType)

            if (existingIdx >= 0) {
                const existing = prev[existingIdx]
                const newQty = existing.quantity + qty

                if (itemType === 'product' && item.quantity !== undefined && newQty > item.quantity) {
                    alert(`Stok tidak mencukupi. Tersedia: ${item.quantity}`)
                    return prev
                }

                const updated = [...prev]
                updated[existingIdx] = {
                    ...existing,
                    quantity: newQty,
                    subtotal: existing.price * newQty
                }
                return updated
            }

            if (itemType === 'product' && item.quantity !== undefined && qty > item.quantity) {
                alert(`Stok tidak mencukupi. Tersedia: ${item.quantity}`)
                return prev
            }

            return [
                ...prev,
                {
                    id: cartItemId,
                    product_id: itemType === 'product' ? item.id : null,
                    treatment_id: itemType === 'treatment' ? item.id : null,
                    coupon_id: itemType === 'coupon' ? item.id : null,
                    item_type: itemType,
                    name: cartItemName,
                    variant_name: selectedVariant ? selectedVariant.name : null,
                    price: unitPrice,
                    original_price: basePrice,
                    quantity: qty,
                    maxQuantity: itemType === 'product' ? item.quantity : null,
                    discount_percent: discountPercent,
                    custom_discount_nominal: customDiscountNominal,
                    subtotal: unitPrice * qty,
                    commission_percent: itemType === 'treatment' ? (item.commission_percent || 0) : 0,
                    is_using_coupon: isUsingCoupon,
                    coupon_already_deducted: false,
                    used_coupon_item_id: usedCouponItemId,
                    coupon_package_name: couponPackageName,
                    remaining_sessions: remainingSessions,
                    therapist_id: selectedTherapistId || (therapists[0]?.id || '')
                }
            ]
        })

        handleCloseItemModal()
    }

    // Categorized products grouped for horizontal scrolling (GD Cashier style)
    const groupedProductCategories = useMemo(() => {
        const q = searchQuery.toLowerCase().trim()
        const filteredProducts = products.filter(p => !q || p.name.toLowerCase().includes(q))

        const dbCategoryNames = (categories || []).map(c => c.name)
        const productCategoryOrder = [
            'YUFADERMA ACNE',
            'YUFADERMA BRIGHT',
            'Ayumi Produk',
            'Dekoratif',
            ...dbCategoryNames,
            ...DEFAULT_CATEGORY_ORDER
        ]

        const categoryMap = {}
        filteredProducts.forEach(p => {
            const cat = getItemCategory(p, 'product')
            if (!categoryMap[cat]) categoryMap[cat] = []
            categoryMap[cat].push({ ...p, itemType: 'product' })
        })

        const result = []
        const seen = new Set()

        productCategoryOrder.forEach(catName => {
            if (!seen.has(catName) && categoryMap[catName] && categoryMap[catName].length > 0) {
                seen.add(catName)
                result.push({
                    name: catName,
                    theme: catName.includes('YUFADERMA') ? 'sky' : (catName.includes('Ayumi') ? 'teal' : 'sky'),
                    items: categoryMap[catName]
                })
            }
        })

        // Catch any remaining product categories
        Object.keys(categoryMap).forEach(catName => {
            if (!seen.has(catName) && categoryMap[catName].length > 0) {
                seen.add(catName)
                result.push({
                    name: catName,
                    theme: 'sky',
                    items: categoryMap[catName]
                })
            }
        })

        return result
    }, [searchQuery, products, categories])

    // Categorized treatments grouped with Option 1 Section Headers (No numbers)
    const groupedTreatmentCategories = useMemo(() => {
        const q = searchQuery.toLowerCase().trim()
        const filteredTreatments = treatments.filter(t => !q || t.name.toLowerCase().includes(q))

        const dbCategoryNames = (categories || []).map(c => c.name)
        const treatmentCategoryOrder = [
            ...dbCategoryNames.filter(c => !['YUFADERMA ACNE', 'YUFADERMA BRIGHT', 'Ayumi Produk', 'Dekoratif'].includes(c)),
            ...DEFAULT_CATEGORY_ORDER
        ]

        const categoryMap = {}
        filteredTreatments.forEach(t => {
            const cat = getItemCategory(t, 'treatment')
            if (!categoryMap[cat]) categoryMap[cat] = []
            categoryMap[cat].push(t)
        })

        const result = []
        const seen = new Set()

        treatmentCategoryOrder.forEach(catName => {
            if (!seen.has(catName) && categoryMap[catName] && categoryMap[catName].length > 0) {
                seen.add(catName)
                result.push({
                    name: catName,
                    items: categoryMap[catName]
                })
            }
        })

        // Catch any remaining categories
        Object.keys(categoryMap).forEach(catName => {
            if (!seen.has(catName) && categoryMap[catName].length > 0) {
                seen.add(catName)
                result.push({
                    name: catName,
                    items: categoryMap[catName]
                })
            }
        })

        return result
    }, [searchQuery, treatments, categories])

    // Categorized coupons grouped with Option 1 Section Headers (No numbers)
    const groupedCouponCategories = useMemo(() => {
        const q = searchQuery.toLowerCase().trim()
        const filteredCoupons = coupons.filter(c => !q || c.name.toLowerCase().includes(q))

        const categoryMap = {}
        filteredCoupons.forEach(c => {
            const cat = getItemCategory(c, 'coupon')
            if (!categoryMap[cat]) categoryMap[cat] = []
            categoryMap[cat].push(c)
        })

        const result = []
        Object.keys(categoryMap).forEach(catName => {
            if (categoryMap[catName].length > 0) {
                result.push({
                    name: catName,
                    items: categoryMap[catName]
                })
            }
        })

        return result
    }, [searchQuery, coupons])

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

    const handleCartItemTherapistChange = (id, therapistId) => {
        setCart(prev => prev.map(x => {
            if (x.id === id && x.item_type === 'treatment') {
                return { ...x, therapist_id: therapistId }
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

        // Validasi wajib terapis per item treatment
        const treatmentItems = cart.filter(item => item.item_type === 'treatment')
        for (const tItem of treatmentItems) {
            const thId = tItem.therapist_id || selectedTherapistId
            if (!thId) {
                alert(`Silakan pilih terapis untuk tindakan "${tItem.name}"! Setiap tindakan perawatan wajib memiliki terapis/pelaksana.`)
                return
            }
        }

        // Validasi Split & Cash Payment
        let finalPaymentMethod = paymentMethod
        let finalNotes = notes || ''

        if (paymentMethod === 'cash') {
            const cashNum = Number(cashReceived) || total
            const changeNum = cashNum >= total ? cashNum - total : 0
            if (cashReceived && cashNum < total) {
                alert(`Uang tunai yang dibayarkan pembeli (Rp ${cashNum.toLocaleString('id-ID')}) masih kurang dari total tagihan (Rp ${total.toLocaleString('id-ID')})!`)
                return
            }
            const cashTag = `[CASH:received=${cashNum};change=${changeNum}]`
            finalNotes = finalNotes ? `${cashTag} | ${finalNotes}` : cashTag
        } else if (paymentMethod === 'split') {
            const cashVal = Number(splitAmounts.cash) || 0
            const transferVal = Number(splitAmounts.transfer) || 0
            const qrisVal = Number(splitAmounts.qris) || 0
            const debitVal = Number(splitAmounts.debit) || 0
            const creditVal = Number(splitAmounts.credit) || 0
            const splitSum = cashVal + transferVal + qrisVal + debitVal + creditVal

            if (splitSum !== total) {
                alert(`Total rincian split payment (Rp ${splitSum.toLocaleString('id-ID')}) belum sesuai dengan total tagihan (Rp ${total.toLocaleString('id-ID')}). Selisih: Rp ${Math.abs(total - splitSum).toLocaleString('id-ID')}`)
                return
            }

            const pairs = []
            if (cashVal > 0) pairs.push(`cash=${cashVal}`)
            if (transferVal > 0) pairs.push(`transfer=${transferVal}`)
            if (qrisVal > 0) pairs.push(`qris=${qrisVal}`)
            if (debitVal > 0) pairs.push(`debit=${debitVal}`)
            if (creditVal > 0) pairs.push(`credit=${creditVal}`)

            const splitTag = `[SPLIT:${pairs.join(';')}]`
            finalNotes = finalNotes ? `${splitTag} | ${finalNotes}` : splitTag

            // Gunakan metode dengan nominal terbesar untuk memenuhi constraint database
            const methodEntries = [
                { m: 'cash', amt: cashVal },
                { m: 'transfer', amt: transferVal },
                { m: 'qris', amt: qrisVal },
                { m: 'debit', amt: debitVal },
                { m: 'credit', amt: creditVal }
            ]
            methodEntries.sort((a, b) => b.amt - a.amt)
            finalPaymentMethod = methodEntries[0]?.m || 'cash'
        }

        setIsProcessing(true)

        try {
            // Extract treatment_record_id if we loaded from pending bills
            let treatmentRecordId = cart.find(i => i.treatment_record_id)?.treatment_record_id || null

            // If it is a direct treatment checkout, create parent treatment records grouped by therapist
            const hasDirectTreatment = cart.some(item => item.item_type === 'treatment' && !item.treatment_record_id)
            if (hasDirectTreatment) {
                const thGroups = new Map()
                treatmentItems.forEach(tItem => {
                    if (tItem.treatment_record_id) return
                    const thId = tItem.therapist_id || selectedTherapistId
                    const isWorker = thId === 'worker'
                    const key = isWorker ? 'worker' : thId
                    if (!thGroups.has(key)) {
                        thGroups.set(key, {
                            performed_by: isWorker ? null : thId,
                            isWorker,
                            items: []
                        })
                    }
                    thGroups.get(key).items.push(tItem)
                })

                const todayDateStr = new Date().toISOString().split('T')[0]
                const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false })

                for (const [key, group] of thGroups.entries()) {
                    const { data: newTr, error: trErr } = await supabase
                        .from('treatment_records')
                        .insert([{
                            patient_id: selectedPatient?.id || null,
                            branch_id: selectedBranch,
                            performed_by: group.performed_by,
                            complaints: group.isWorker ? '[INFUS - WORKER]' : null,
                            result_notes: group.isWorker ? 'Sesi Infus dikerjakan oleh Worker' : 'Tindakan Kasir Langsung',
                            treatment_date: todayDateStr,
                            treatment_time: timeStr
                        }])
                        .select()
                        .single()

                    if (trErr) throw trErr
                    if (!treatmentRecordId) treatmentRecordId = newTr.id

                    // Simpan rincian treatment_record_items untuk kelompok terapis ini
                    if (newTr?.id) {
                        const trItemPayloads = group.items.map((it, sIdx) => ({
                            treatment_record_id: newTr.id,
                            treatment_id: it.id,
                            price_at_time: it.price,
                            original_price: it.original_price || it.price,
                            discount_percent: it.discount_percent || 0,
                            commission_percent: it.commission_percent || 5,
                            notes: it.name,
                            sort_order: sIdx + 1
                        }))
                        await supabase.from('treatment_record_items').insert(trItemPayloads)
                    }
                }
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
                    p_payment_method: finalPaymentMethod,
                    p_payment_status: 'paid',
                    p_notes: finalNotes,
                    p_created_by: dbUser?.id,
                    p_items: itemsPayload
                })

            if (rpcError) throw rpcError

            if (!trxData || !trxData.id) {
                throw new Error('Gagal mendapatkan data transaksi dari database.')
            }

            // Potong sesi kupon lewat Server API /api/coupons/redeem
            const failedCoupons = []

            // 1. Sesi pertama dari pembelian paket kupon baru (jika ada tindakan hari ini dari paket baru)
            const firstSessionItems = cart.filter(item => item.is_first_session_of_new_coupon)
            for (const fsItem of firstSessionItems) {
                if (selectedPatient) {
                    try {
                        const { data: newCouponItem } = await supabase
                            .from('patient_coupon_items')
                            .select('id, total_sessions, used_sessions, remaining_sessions, patient_coupons!inner(transaction_id)')
                            .eq('patient_coupons.transaction_id', trxData.id)
                            .eq('treatment_id', fsItem.id)
                            .maybeSingle()

                        if (newCouponItem) {
                            const res = await fetch('/api/coupons/redeem', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    coupon_item_id: newCouponItem.id,
                                    patient_id: selectedPatient.id,
                                    quantity: 1,
                                    transaction_id: trxData.id,
                                    treatment_record_id: fsItem.treatment_record_id || treatmentRecordId || null,
                                    branch_id: selectedBranch,
                                    used_by: dbUser?.id,
                                    notes: `Sesi 1 digunakan langsung saat pembelian paket (${trxData.transaction_number || trxData.id?.substring(0, 8)})`
                                })
                            })
                            const resJson = await res.json()
                            if (!res.ok || resJson.error) {
                                throw new Error(resJson.error || 'Gagal memotong sesi 1 paket baru')
                            }
                        }
                    } catch (fsErr) {
                        console.error('Error memotong sesi 1 paket baru:', fsErr)
                        failedCoupons.push(`${fsItem.name}: ${fsErr.message}`)
                    }
                }
            }

            // 2. Potong sesi kupon aktif lama
            for (const cartItem of cart) {
                if (cartItem.is_using_coupon && cartItem.used_coupon_item_id && !cartItem.coupon_already_deducted && !cartItem.is_first_session_of_new_coupon && selectedPatient) {
                    try {
                        const res = await fetch('/api/coupons/redeem', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                coupon_item_id: cartItem.used_coupon_item_id,
                                patient_id: selectedPatient.id,
                                quantity: cartItem.quantity || 1,
                                transaction_id: trxData.id,
                                treatment_record_id: cartItem.treatment_record_id || treatmentRecordId || null,
                                branch_id: selectedBranch,
                                used_by: dbUser?.id,
                                notes: `Klaim Kasir (${trxData.transaction_number || trxData.id?.substring(0, 8)})`
                            })
                        })
                        const resJson = await res.json()
                        if (!res.ok || resJson.error) {
                            throw new Error(resJson.error || 'Gagal memotong sesi kupon')
                        }
                    } catch (redeemErr) {
                        console.error('Gagal memotong sesi kupon:', redeemErr)
                        failedCoupons.push(`${cartItem.name}: ${redeemErr.message}`)
                    }
                }
            }

            // 3. Pastikan treatment_record_id terhubung ke transaksi jika ada
            if (treatmentRecordId && trxData.id) {
                try {
                    await supabase
                        .from('transactions')
                        .update({ treatment_record_id: treatmentRecordId })
                        .eq('id', trxData.id)
                } catch (linkErr) {
                    console.warn('Warning linking treatment record to transaction:', linkErr)
                }
            }

            // Pembayaran sudah tersimpan, jika ada sesi gagal beri tahu kasir
            if (failedCoupons.length > 0) {
                alert(
                    'PERHATIAN: Pembayaran berhasil disimpan, tetapi sesi kupon berikut GAGAL dipotong otomatis:\n\n' +
                    failedCoupons.join('\n') +
                    '\n\nSisa sesi kupon pelanggan ini perlu diperiksa di menu Kupon Pasien.'
                )
            }

            // Clear active draft from localStorage & Navigate to Receipt page
            try {
                localStorage.removeItem('ayumi_pos_active_draft')
            } catch (e) {}
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
                                    const totalBill = bill.treatment_record_items?.reduce((s, i) => {
                                        const rawNotes = i.notes || ''
                                        const matchNewPkg = rawNotes.match(/\[KUPON_BARU:([^:]+):([^:]+):([^\]]+)\]/)
                                        if (matchNewPkg) {
                                            return s + (Number(matchNewPkg[3]) || 0)
                                        }
                                        return s + (i.price_at_time || 0)
                                    }, 0) || 0
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
                                                    {bill.treatment_record_items?.slice(0,3).map((it, i) => {
                                                        const rawNotes = it.notes || ''
                                                        const matchNewPkg = rawNotes.match(/\[KUPON_BARU:([^:]+):([^:]+):([^\]]+)\]/)
                                                        if (matchNewPkg) {
                                                            return (
                                                                <span key={i} className="bg-purple-100 text-purple-800 border border-purple-200 text-[10px] font-extrabold px-2 py-0.5 rounded-md flex items-center gap-1">
                                                                    <span>🎁</span>
                                                                    <span>Paket {matchNewPkg[2]}</span>
                                                                </span>
                                                            )
                                                        }
                                                        return (
                                                            <span key={i} className="bg-purple-50/70 text-purple-700 border border-purple-100/50 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                                                {it.treatments?.name?.split(' ').slice(0,2).join(' ') || 'Treatment'}
                                                            </span>
                                                        )
                                                    })}
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
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden flex-1 flex flex-col">
                        
                        {/* Subtabs catalog & Universal Search Bar */}
                        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between border-b border-gray-100 bg-gray-50/60 p-3 sm:px-4 sm:py-3 gap-3">
                            {/* Tabs with Distinct Clean Highlights */}
                            <div className="flex bg-gray-200/70 p-1 rounded-xl gap-1 overflow-x-auto custom-scrollbar shrink-0">
                                {(() => {
                                    const filteredTreatments = treatments.filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                    const filteredProducts = products.filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                    const filteredCoupons = coupons.filter(c => !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                    const totalMatches = filteredTreatments.length + filteredProducts.length + filteredCoupons.length

                                    const tabs = [
                                        ...(searchQuery.trim() ? [{
                                            key: 'all',
                                            label: 'Semua',
                                            count: totalMatches,
                                            activeStyle: 'bg-[#4E2A12] text-white shadow-xs font-black',
                                            inactiveHover: 'hover:text-[#4E2A12] hover:bg-white/60'
                                        }] : []),
                                        {
                                            key: 'treatment',
                                            label: 'Treatment',
                                            count: searchQuery.trim() ? filteredTreatments.length : treatments.length,
                                            activeStyle: 'bg-[#D46221] text-white shadow-xs font-black',
                                            inactiveHover: 'hover:text-[#D46221] hover:bg-[#FAF1E8]'
                                        },
                                        {
                                            key: 'product',
                                            label: 'Produk',
                                            count: searchQuery.trim() ? filteredProducts.length : products.length,
                                            activeStyle: 'bg-[#2D6A4F] text-white shadow-xs font-black',
                                            inactiveHover: 'hover:text-[#2D6A4F] hover:bg-emerald-50/60'
                                        },
                                        {
                                            key: 'coupon',
                                            label: 'Paket Kupon',
                                            count: searchQuery.trim() ? filteredCoupons.length : coupons.length,
                                            activeStyle: 'bg-[#B5531B] text-white shadow-xs font-black',
                                            inactiveHover: 'hover:text-[#B5531B] hover:bg-[#FAF1E8]'
                                        },
                                    ]

                                    return tabs.map(tab => {
                                        const isActive = activeTab === tab.key
                                        return (
                                            <button
                                                key={tab.key}
                                                type="button"
                                                onClick={() => setActiveTab(tab.key)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                                                    isActive 
                                                        ? tab.activeStyle 
                                                        : `text-gray-600 ${tab.inactiveHover}`
                                                }`}
                                            >
                                                <span>{tab.label}</span>
                                                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                                                    isActive 
                                                        ? 'bg-white/25 text-white' 
                                                        : 'bg-gray-200/80 text-gray-700'
                                                }`}>
                                                    {tab.count}
                                                </span>
                                            </button>
                                        )
                                    })
                                })()}
                            </div>
                            
                            {/* Search bar - Wider & Responsive with Clear Button */}
                            <div className="relative flex-1 max-w-full md:max-w-md w-full">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 pointer-events-none">
                                    <svg className="w-4 h-4 text-[#D46221]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                </span>
                                <input
                                    type="text"
                                    placeholder="Cari treatment, produk skincare, kupon..."
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value)
                                        if (e.target.value && activeTab !== 'all' && activeTab !== 'treatment' && activeTab !== 'product' && activeTab !== 'coupon') {
                                            setActiveTab('all')
                                        }
                                    }}
                                    className="input-ayumi pl-9.5 pr-8 bg-white w-full text-xs sm:text-sm py-2 border-gray-200 focus:border-[#D46221] focus:ring-2 focus:ring-[#F2D8C3] rounded-xl shadow-2xs font-medium"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-gray-400 hover:text-gray-600 cursor-pointer"
                                        title="Hapus pencarian"
                                    >
                                        <svg className="w-4 h-4 bg-gray-100 hover:bg-gray-200 rounded-full p-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Items list rendered as POS card grid for Treatment & Kupon, and Categorized for Products */}
                        <div className="p-3 sm:p-4 overflow-y-auto max-h-[66vh] custom-scrollbar flex-1 bg-[#FAF6F0]/40">
                            {(() => {
                                const q = searchQuery.toLowerCase().trim()
                                const filteredTreatments = treatments.filter(t => !q || t.name.toLowerCase().includes(q))
                                const filteredProducts = products.filter(p => !q || p.name.toLowerCase().includes(q))
                                const filteredCoupons = coupons.filter(c => !q || c.name.toLowerCase().includes(q))
                                const totalMatches = filteredTreatments.length + filteredProducts.length + filteredCoupons.length

                                // Branch not selected warning for products
                                if (!selectedBranch && activeTab === 'product') {
                                    return (
                                        <div className="flex flex-col items-center justify-center py-16 text-gray-400 text-center my-auto">
                                            <svg className="w-8 h-8 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 5h2a2 2 0 002-2v-1a2 2 0 00-2-2h-2a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>
                                            <p className="text-xs font-semibold">Pilih cabang terlebih dahulu untuk melihat stok produk</p>
                                        </div>
                                    )
                                }

                                // If search query active and no matches at all
                                if (q && totalMatches === 0) {
                                    return (
                                        <div className="flex flex-col items-center justify-center py-16 text-gray-400 text-center my-auto space-y-2">
                                            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                            </div>
                                            <p className="text-sm font-bold text-gray-700">Tidak ada item ditemukan</p>
                                            <p className="text-xs text-gray-400">Tidak ditemukan treatment, produk, atau kupon dengan kata kunci &quot;{searchQuery}&quot;.</p>
                                            <button
                                                type="button"
                                                onClick={() => setSearchQuery('')}
                                                className="mt-2 text-xs bg-[#FAF1E8] hover:bg-[#F2D8C3] text-[#D46221] font-bold px-3 py-1.5 rounded-lg transition-colors border border-[#F2D8C3] cursor-pointer"
                                            >
                                                Reset Pencarian
                                            </button>
                                        </div>
                                    )
                                }

                                const showAll = activeTab === 'all'
                                const showTreatments = showAll || activeTab === 'treatment'
                                const showProducts = showAll || activeTab === 'product'
                                const showCoupons = showAll || activeTab === 'coupon'

                                // Notice when user is on a specific tab with 0 results but other tabs have matches
                                const currentTabEmpty = (activeTab === 'treatment' && filteredTreatments.length === 0) ||
                                                        (activeTab === 'product' && filteredProducts.length === 0) ||
                                                        (activeTab === 'coupon' && filteredCoupons.length === 0)

                                return (
                                    <div className="space-y-6">
                                        {/* Cross-category Match Notification */}
                                        {q && currentTabEmpty && totalMatches > 0 && (
                                            <div className="bg-[#FAF1E8] border border-[#F2D8C3] rounded-2xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-2xs animate-fade-in">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2 h-2 rounded-full bg-[#D46221] shrink-0"></span>
                                                    <div className="text-xs text-[#4E2A12] font-medium">
                                                        Tidak ada hasil di tab ini, namun ditemukan <strong className="font-extrabold text-[#2C1E16]">{totalMatches} item</strong> di kategori lain untuk &quot;{searchQuery}&quot;:
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveTab('all')}
                                                        className="text-xs bg-[#4E2A12] hover:bg-[#2C1E16] text-white px-2.5 py-1 rounded-lg font-bold transition-colors shadow-2xs cursor-pointer"
                                                    >
                                                        Lihat Semua ({totalMatches})
                                                    </button>
                                                    {filteredTreatments.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setActiveTab('treatment')}
                                                            className="text-xs bg-[#FAF1E8] hover:bg-[#F2D8C3] text-[#B5531B] px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer"
                                                        >
                                                            Treatment ({filteredTreatments.length})
                                                        </button>
                                                    )}
                                                    {filteredProducts.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setActiveTab('product')}
                                                            className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-800 px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer"
                                                        >
                                                            Produk ({filteredProducts.length})
                                                        </button>
                                                    )}
                                                    {filteredCoupons.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setActiveTab('coupon')}
                                                            className="text-xs bg-[#FAF1E8] hover:bg-[#F2D8C3] text-[#B5531B] px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer"
                                                        >
                                                            Kupon ({filteredCoupons.length})
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* 1. TREATMENTS (Berkategori dengan Option 1 Banner Elegan Ivory & Terracotta) */}
                                        {showTreatments && (
                                            <div className="space-y-6">
                                                {showAll && (
                                                    <div className="flex items-center gap-2 pb-1 border-b border-[#F2D8C3]">
                                                        <h2 className="font-black text-xs sm:text-sm text-[#4E2A12] tracking-wider uppercase px-1">
                                                            Katalog Treatment Perawatan ({filteredTreatments.length})
                                                        </h2>
                                                    </div>
                                                )}
                                                {groupedTreatmentCategories.length === 0 ? (
                                                    <div className="py-8 text-center text-xs text-gray-400">
                                                        Tidak ada treatment ditemukan.
                                                    </div>
                                                ) : (
                                                    <div className="space-y-6">
                                                        {groupedTreatmentCategories.map(group => (
                                                            <div key={group.name} className="space-y-3">
                                                                {/* Option 1 Banner Header (No numbers) */}
                                                                <div className="flex items-center justify-between bg-[#FAF1E8] border border-[#F2D8C3] border-l-4 border-l-[#D46221] px-4 py-2.5 rounded-xl shadow-2xs">
                                                                    <div className="flex items-center gap-2.5">
                                                                        <span className="w-2 h-2 rounded-full bg-[#D46221]"></span>
                                                                        <h3 className="font-black text-xs sm:text-sm text-[#4E2A12] tracking-wider uppercase">
                                                                            {group.name}
                                                                        </h3>
                                                                    </div>
                                                                    <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-white text-[#B5531B] border border-[#F2D8C3] shadow-2xs">
                                                                        {group.items.length} Item
                                                                    </span>
                                                                </div>

                                                                {/* 3-Column Card Grid */}
                                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
                                                                    {group.items.map(t => {
                                                                        const hasDiscount = t.discount_percent > 0
                                                                        const price = hasDiscount ? t.price * (1 - t.discount_percent / 100) : t.price
                                                                        return (
                                                                            <div
                                                                                key={`tr-${t.id}`}
                                                                                onClick={() => addToCart(t, 'treatment')}
                                                                                className="bg-white p-3.5 rounded-2xl border border-[#F2D8C3] shadow-2xs flex flex-col justify-between hover:border-[#D46221] hover:shadow-md transition-all cursor-pointer group relative hover:-translate-y-0.5"
                                                                            >
                                                                                <div className="space-y-1.5 mb-2">
                                                                                    <div className="flex items-center justify-between gap-1 flex-wrap">
                                                                                        <span className="bg-[#FAF1E8] text-[#B5531B] border border-[#F2D8C3] text-[9px] font-bold px-2 py-0.5 rounded-md">
                                                                                            Treatment
                                                                                        </span>
                                                                                        {hasDiscount && (
                                                                                            <span className="bg-[#D46221] text-white text-[9px] font-black px-1.5 py-0.5 rounded-md shadow-2xs">
                                                                                                Diskon {t.discount_percent}%
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                    <h4 className="font-extrabold text-xs sm:text-sm text-[#2C1E16] line-clamp-2 leading-snug group-hover:text-[#D46221] transition-colors">
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
                                                                                        <span className="font-black text-xs sm:text-sm text-[#D46221] whitespace-nowrap">
                                                                                            Rp {price.toLocaleString('id-ID')}
                                                                                        </span>
                                                                                    </div>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation()
                                                                                            addToCart(t, 'treatment')
                                                                                        }}
                                                                                        className="w-7 h-7 rounded-xl bg-[#D46221] hover:bg-[#B5531B] text-white flex items-center justify-center font-black text-sm transition-all shrink-0 shadow-xs cursor-pointer active:scale-95"
                                                                                        title="Tambah ke keranjang"
                                                                                    >
                                                                                        +
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        )
                                                                    })}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* 2. PRODUK (Berkategori + Horizontal Scrolling + Modal Varian) */}
                                        {showProducts && (
                                            <div className="space-y-4">
                                                {showAll && (
                                                    <h3 className="font-black text-xs text-[#4E2A12] tracking-wider uppercase px-1">
                                                        Produk Skincare ({filteredProducts.length})
                                                    </h3>
                                                )}
                                                {groupedProductCategories.length === 0 ? (
                                                    <div className="py-8 text-center text-xs text-gray-400">
                                                        Tidak ada produk aktif di cabang ini.
                                                    </div>
                                                ) : (
                                                    <div className="space-y-5">
                                                        {groupedProductCategories.map(group => (
                                                            <HorizontalCategoryRow
                                                                key={group.name}
                                                                categoryName={group.name}
                                                                items={group.items}
                                                                onItemClick={(item, type) => handleOpenItemModal(item, type)}
                                                            />
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* 3. KUPON (Berkategori dengan Option 1 Banner Elegan Ivory & Terracotta) */}
                                        {showCoupons && (
                                            <div className="space-y-6">
                                                {showAll && (
                                                    <div className="flex items-center gap-2 pb-1 border-b border-[#F2D8C3]">
                                                        <h2 className="font-black text-xs sm:text-sm text-[#4E2A12] tracking-wider uppercase px-1">
                                                            Katalog Paket Kupon ({filteredCoupons.length})
                                                        </h2>
                                                    </div>
                                                )}
                                                {groupedCouponCategories.length === 0 ? (
                                                    <div className="py-8 text-center text-xs text-gray-400">
                                                        Tidak ada paket kupon ditemukan.
                                                    </div>
                                                ) : (
                                                    <div className="space-y-6">
                                                        {groupedCouponCategories.map(group => (
                                                            <div key={group.name} className="space-y-3">
                                                                {/* Option 1 Banner Header (No numbers) */}
                                                                <div className="flex items-center justify-between bg-[#FAF1E8] border border-[#F2D8C3] border-l-4 border-l-[#D46221] px-4 py-2.5 rounded-xl shadow-2xs">
                                                                    <div className="flex items-center gap-2.5">
                                                                        <span className="w-2.5 h-2.5 rounded-full bg-[#D46221]"></span>
                                                                        <h3 className="font-black text-xs sm:text-sm text-[#4E2A12] tracking-wider uppercase">
                                                                            {group.name}
                                                                        </h3>
                                                                    </div>
                                                                    <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-white text-[#B5531B] border border-[#F2D8C3] shadow-2xs">
                                                                        {group.items.length} Paket
                                                                    </span>
                                                                </div>

                                                                {/* 3-Column Card Grid */}
                                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
                                                                    {group.items.map(c => (
                                                                        <div
                                                                            key={`cp-${c.id}`}
                                                                            onClick={() => addToCart(c, 'coupon')}
                                                                            className="bg-white p-3.5 rounded-2xl border border-[#F2D8C3] shadow-2xs flex flex-col justify-between hover:border-[#D46221] hover:shadow-md transition-all cursor-pointer group relative hover:-translate-y-0.5"
                                                                        >
                                                                            <div className="space-y-1.5 mb-2">
                                                                                <div className="flex items-center justify-between gap-1 flex-wrap">
                                                                                    <span className="bg-[#FAF1E8] text-[#B5531B] border border-[#F2D8C3] text-[9px] font-bold px-2 py-0.5 rounded-md">
                                                                                        Paket Kupon
                                                                                    </span>
                                                                                    {c.category && (
                                                                                        <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                                                                                            {c.category}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <h4 className="font-extrabold text-xs sm:text-sm text-[#2C1E16] line-clamp-2 leading-snug group-hover:text-[#D46221] transition-colors">
                                                                                    {c.name}
                                                                                </h4>
                                                                            </div>

                                                                            <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-auto gap-1.5">
                                                                                <span className="font-black text-xs sm:text-sm text-[#D46221] whitespace-nowrap">
                                                                                    Rp {c.price.toLocaleString('id-ID')}
                                                                                </span>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation()
                                                                                        addToCart(c, 'coupon')
                                                                                    }}
                                                                                    className="w-7 h-7 rounded-xl bg-[#D46221] hover:bg-[#B5531B] text-white flex items-center justify-center font-black text-sm transition-all shrink-0 shadow-xs cursor-pointer active:scale-95"
                                                                                    title="Tambah ke keranjang"
                                                                                >
                                                                                    +
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )
                            })()}
                        </div>
                    </div>
                )}
            </div>

            {/* ─── PANEL KANAN: KERANJANG & CHECKOUT RINGKAS ─── */}
            <div className="w-full lg:w-2/5 flex flex-col bg-white rounded-3xl shadow-lg border border-gray-100 relative overflow-hidden max-h-[calc(100vh-100px)]">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-ayumi-secondary to-ayumi-primary"></div>
                
                {/* Patient Selector */}
                <div className="p-3.5 border-b border-gray-100 pt-4 bg-white shrink-0">
                    <div className="flex items-center justify-between gap-1.5 mb-1.5 flex-wrap">
                        <label className="text-[11px] font-black text-gray-500 uppercase tracking-wider">
                            Pelanggan (Wajib Diisi)
                        </label>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Held Drafts Badge Button */}
                            {heldTransactions.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setIsHeldModalOpen(true)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-black bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-300 transition-all shadow-2xs cursor-pointer animate-pulse"
                                    title="Buka daftar transaksi yang sedang ditahan"
                                >
                                    <span>📂</span>
                                    <span>Draft ({heldTransactions.length})</span>
                                </button>
                            )}

                            {/* Hold Active Transaction Button */}
                            {(cart.length > 0 || selectedPatient) && (
                                <button
                                    type="button"
                                    onClick={handleHoldTransaction}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-extrabold bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-200 transition-all shadow-2xs cursor-pointer"
                                    title="Simpan / Tahan tagihan ini sementara agar bisa melayani pasien lain"
                                >
                                    <span>⏸️</span>
                                    <span>Simpan Tagihan</span>
                                </button>
                            )}

                            {/* Reset / Clear Cart Button */}
                            {(cart.length > 0 || selectedPatient) && (
                                <button
                                    type="button"
                                    onClick={handleResetCart}
                                    className="text-gray-400 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50 border border-transparent hover:border-rose-100 transition-colors cursor-pointer"
                                    title="Kosongkan keranjang & mulai transaksi baru"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            )}
                        </div>
                    </div>
                    {selectedPatient ? (
                        <div className="flex justify-between items-center bg-pink-50/50 p-2.5 rounded-xl border border-pink-100/70 shadow-2xs relative overflow-hidden transition-all">
                            <div className="flex items-center gap-2.5 min-w-0">
                                {/* Initial Avatar */}
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-ayumi-primary to-rose-400 flex items-center justify-center text-white font-black text-xs shadow-inner shrink-0">
                                    {(selectedPatient.full_name?.charAt(0) || '?').toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <p className="font-extrabold text-gray-900 leading-tight text-xs truncate max-w-[140px] sm:max-w-[200px]">{selectedPatient.full_name}</p>
                                        <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-full border ${
                                            (selectedPatientDetails?.crmStatus === 'Active') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                            (selectedPatientDetails?.crmStatus === 'Warm') ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                            (selectedPatientDetails?.crmStatus === 'Dormant') ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                            'bg-blue-50 text-blue-700 border-blue-200'
                                        }`}>
                                            {selectedPatientDetails?.crmStatus || 'New'}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-gray-500 mt-0.5 tracking-tight">{selectedPatient.whatsapp || 'No HP tidak ada'}</p>
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
                                className="text-gray-400 hover:text-rose-600 p-1.5 bg-white hover:bg-rose-50 rounded-lg transition-all border border-gray-100 shadow-2xs shrink-0"
                                title="Ganti Pasien"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    ) : isQuickAddInlineOpen ? (
                        /* Inline Quick Add Patient Form */
                        <form onSubmit={handleQuickAddPatient} className="bg-pink-50/30 p-3 rounded-xl border border-pink-100/60 shadow-2xs space-y-2 transition-all">
                            <div className="flex justify-between items-center">
                                <h3 className="font-extrabold text-[11px] text-ayumi-secondary uppercase tracking-wider">Tambah Pasien Cepat</h3>
                                <button 
                                    type="button" 
                                    onClick={() => {
                                        setIsQuickAddInlineOpen(false)
                                        setQuickAddError('')
                                    }} 
                                    className="text-[11px] text-gray-400 hover:text-gray-600 font-bold"
                                >
                                    Batal
                                </button>
                            </div>
                            
                            {quickAddConflict && (
                                <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg space-y-1 text-left">
                                    <p className="text-[10px] font-bold text-amber-900">⚠️ Nomor WhatsApp Sudah Terdaftar</p>
                                    <p className="text-[10px] text-amber-800 leading-tight">
                                        Nomor <span className="font-mono font-bold">{quickAddConflict.whatsapp}</span> atas nama <strong>{quickAddConflict.full_name}</strong>.
                                    </p>
                                    <div className="flex items-center gap-1.5 pt-0.5">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                handleSelectPatient(quickAddConflict)
                                                setQuickAddConflict(null)
                                                setQuickAddForm({ full_name: '', whatsapp: '' })
                                                setIsQuickAddInlineOpen(false)
                                            }}
                                            className="flex-1 bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-bold py-1 px-2 rounded-md transition-all"
                                        >
                                            ✓ Pakai Pasien Ini
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setQuickAddConflict(null)}
                                            className="bg-white text-gray-600 text-[9px] font-bold py-1 px-2 rounded-md border border-amber-300"
                                        >
                                            Batal
                                        </button>
                                    </div>
                                </div>
                            )}

                            {quickAddError && (
                                <p className="text-[10px] text-red-500 font-semibold">{quickAddError}</p>
                            )}

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <input 
                                        type="text" 
                                        placeholder="Nama Lengkap"
                                        value={quickAddForm.full_name}
                                        onChange={(e) => setQuickAddForm(prev => ({ ...prev, full_name: e.target.value }))}
                                        className="input-ayumi w-full bg-white text-xs py-1"
                                        required
                                    />
                                </div>
                                <div>
                                    <input 
                                        type="tel" 
                                        placeholder="No. WA (08...)"
                                        value={quickAddForm.whatsapp}
                                        onChange={(e) => setQuickAddForm(prev => ({ ...prev, whatsapp: e.target.value }))}
                                        className="input-ayumi w-full bg-white text-xs py-1"
                                        required
                                    />
                                </div>
                            </div>

                            <button 
                                type="submit" 
                                disabled={isQuickAdding}
                                className="w-full bg-ayumi-primary hover:bg-ayumi-primary-hover text-white text-xs font-bold py-1.5 px-3 rounded-lg transition-all flex items-center justify-center gap-1 shadow-xs"
                            >
                                {isQuickAdding ? 'Menyimpan...' : '✓ Simpan & Pilih'}
                            </button>
                        </form>
                    ) : (
                        <div className="relative">
                            <div className="relative flex items-center">
                                <span className="absolute left-2.5 text-gray-400">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
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
                                    className="input-ayumi w-full pl-8 py-1.5 bg-gray-50/80 border-gray-200 focus:bg-white text-xs"
                                />
                                {searchPatientQuery && (
                                    <button 
                                        type="button" 
                                        onClick={() => setSearchPatientQuery('')} 
                                        className="absolute right-2.5 text-gray-400 hover:text-gray-600"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                )}
                            </div>
                            {isPatientDropdownOpen && (
                                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-100 shadow-xl rounded-xl max-h-56 overflow-y-auto custom-scrollbar divide-y divide-gray-50">
                                    {searchPatientQuery.trim().length < 2 ? (
                                        <div className="p-3 text-center text-[11px] text-gray-400">
                                            Ketik minimal 2 karakter...
                                        </div>
                                    ) : isSearchingPatient ? (
                                        <div className="p-3 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
                                            <div className="w-3 h-3 border-2 border-ayumi-primary border-t-transparent rounded-full animate-spin"></div>
                                            <span>Mencari...</span>
                                        </div>
                                    ) : patientSearchResults.length > 0 ? (
                                        patientSearchResults.map(p => (
                                            <div 
                                                key={p.id} 
                                                onClick={() => handleSelectPatient(p)}
                                                className="px-3.5 py-2 hover:bg-pink-50/40 cursor-pointer transition-colors flex items-center justify-between group"
                                            >
                                                <div className="min-w-0">
                                                    <p className="font-bold text-gray-800 text-xs truncate">{p.full_name}</p>
                                                    <p className="text-[10px] text-gray-400">{p.whatsapp || 'No HP tidak ada'}</p>
                                                </div>
                                                <span className="text-[10px] text-ayumi-primary font-bold opacity-0 group-hover:opacity-100 transition-opacity">Pilih →</span>
                                            </div>
                                        ))
                                    ) : !isSearchingPatient && hasSearchedPatient && patientSearchResults.length === 0 ? (
                                        <div className="p-3 text-center space-y-1.5">
                                            <p className="text-[11px] text-gray-500">Tidak ada "{searchPatientQuery}".</p>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setQuickAddForm({ full_name: searchPatientQuery, whatsapp: '' })
                                                    setIsQuickAddInlineOpen(true)
                                                    setIsPatientDropdownOpen(false)
                                                }}
                                                className="w-full bg-pink-50 hover:bg-pink-100 text-ayumi-primary text-[11px] font-bold py-1.5 px-2.5 rounded-lg transition-all"
                                            >
                                                + Daftarkan "{searchPatientQuery}"
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Cart Items List */}
                <div className="flex-1 overflow-y-auto p-3 custom-scrollbar bg-slate-50/40 space-y-2">
                    {cart.length === 0 ? (
                        !selectedPatient ? (
                            <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-center p-4 gap-2">
                                <div className="w-12 h-12 bg-pink-50 rounded-full flex items-center justify-center shadow-inner">
                                    <svg className="w-6 h-6 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                </div>
                                <div>
                                    <p className="text-xs font-extrabold text-gray-800">Pilih Pelanggan Dahulu</p>
                                    <p className="text-[11px] text-gray-400 mt-0.5 max-w-[200px] leading-tight">Cari nama atau nomor WhatsApp pasien untuk memulai transaksi</p>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-center p-4 gap-2">
                                <div className="w-12 h-12 bg-purple-50 rounded-full flex items-center justify-center shadow-inner">
                                    <svg className="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                                </div>
                                <div>
                                    <p className="text-xs font-extrabold text-gray-800">Keranjang Masih Kosong</p>
                                    <p className="text-[11px] text-gray-400 mt-0.5 max-w-[200px] leading-tight">Pilih treatment, produk, atau kupon di katalog sebelah kiri</p>
                                </div>
                            </div>
                        )
                    ) : (
                        cart.map((item, idx) => (
                            <div key={idx} className="flex flex-col bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs hover:border-pink-200 transition-all">
                                {/* Top row: badge, name & delete button */}
                                <div className="flex items-start justify-between gap-1.5">
                                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className={`text-[8px] font-extrabold uppercase tracking-wider px-1.5 py-0.2 rounded-md ${
                                                item.item_type === 'treatment' 
                                                    ? 'bg-purple-50 text-purple-600 border border-purple-100' 
                                                    : item.item_type === 'product'
                                                    ? 'bg-orange-50 text-orange-600 border border-orange-100'
                                                    : 'bg-pink-50 text-pink-600 border border-pink-100'
                                            }`}>
                                                {item.item_type === 'treatment' ? 'Treatment' : item.item_type === 'product' ? 'Produk' : 'Kupon Paket'}
                                            </span>
                                        </div>
                                        <p className="font-extrabold text-gray-800 text-xs leading-snug break-words">{item.name}</p>

                                        {/* Active Coupon Banner & Toggle in Cart Item */}
                                        {item.item_type === 'treatment' && (
                                            <div className="mt-1">
                                                {item.is_using_coupon ? (
                                                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-1.5 rounded-lg text-[10px] flex items-center justify-between gap-1.5">
                                                        <span className="font-bold truncate">🎟️ Kupon: <strong>{item.coupon_package_name}</strong></span>
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleCartItemCoupon(item.id)}
                                                            className="text-[9px] font-black bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-900 px-1.5 py-0.5 rounded transition-colors shrink-0"
                                                        >
                                                            Bayar Normal
                                                        </button>
                                                    </div>
                                                ) : (
                                                    (() => {
                                                        const availableCoupon = patientActiveCoupons.find(c => c.treatment_id === item.id && c.remaining_sessions > 0)
                                                        if (availableCoupon) {
                                                            return (
                                                                <div className="bg-amber-50 border border-amber-200 text-amber-900 p-1.5 rounded-lg text-[10px] flex items-center justify-between gap-1.5">
                                                                    <span className="truncate">💡 Ada Kupon: <strong>{availableCoupon.patient_coupons?.coupon_packages?.name}</strong></span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => toggleCartItemCoupon(item.id)}
                                                                        className="text-[9px] font-black bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded shadow-2xs transition-all shrink-0"
                                                                    >
                                                                        Klaim Kupon (Rp 0)
                                                                    </button>
                                                                </div>
                                                            )
                                                        }
                                                        return null
                                                    })()
                                                )}
                                            </div>
                                        )}

                                        {/* Selector Terapis Per Item Treatment */}
                                        {item.item_type === 'treatment' && (
                                            <div className="mt-1.5 pt-1 border-t border-dashed border-gray-100 flex items-center justify-between gap-1.5">
                                                <span className="text-[9px] font-bold text-gray-500 uppercase shrink-0">👩‍⚕️ Terapis:</span>
                                                <select
                                                    value={item.therapist_id || (selectedTherapistId || '')}
                                                    onChange={(e) => handleCartItemTherapistChange(item.id, e.target.value)}
                                                    className="text-[11px] font-bold bg-pink-50/60 border border-pink-200/80 rounded-md px-1.5 py-0.5 focus:bg-white text-gray-800 flex-1 max-w-[170px]"
                                                >
                                                    <option value="">-- Pilih Terapis --</option>
                                                    <option value="worker">💉 Worker (Tanpa Komisi)</option>
                                                    {therapists.map(t => (
                                                        <option key={t.id} value={t.id}>{t.full_name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                    <button 
                                        type="button" 
                                        onClick={() => removeFromCart(item.id, item.item_type)}
                                        className="w-6 h-6 flex items-center justify-center rounded-lg bg-gray-50 text-gray-400 hover:bg-rose-100 hover:text-rose-600 transition-all shrink-0"
                                        title="Hapus"
                                    >
                                        ✕
                                    </button>
                                </div>

                                {/* Collapsible toggle button */}
                                <div className="flex justify-between items-center mt-1">
                                    <button 
                                        type="button" 
                                        onClick={() => setExpandedCartItem(prev => prev === `${item.id}-${item.item_type}` ? null : `${item.id}-${item.item_type}`)}
                                        className="text-[9px] font-bold text-ayumi-primary hover:underline flex items-center gap-0.5"
                                    >
                                        {expandedCartItem === `${item.id}-${item.item_type}` ? '▲ Sembunyikan Diskon' : `▼ Atur Diskon (Rp ${(item.price || 0).toLocaleString('id-ID')})`}
                                    </button>
                                </div>

                                {/* 2x2 Price Grid (Collapsible) */}
                                {expandedCartItem === `${item.id}-${item.item_type}` && (
                                    <div className="grid grid-cols-2 gap-1.5 mt-1 p-2 bg-gray-50/70 rounded-lg border border-gray-150 animate-fadeIn">
                                        <div className="bg-white p-1.5 rounded-md border border-gray-200">
                                            <label className="text-[8px] font-black uppercase text-gray-400 block">Harga Awal</label>
                                            <input 
                                                type="number" 
                                                value={!item.original_price ? '' : item.original_price} 
                                                onFocus={(e) => e.target.select()}
                                                placeholder="0"
                                                onChange={(e) => handleCartItemOriginalPriceChange(item.id, item.item_type, e.target.value)}
                                                className="w-full text-[11px] font-bold bg-transparent border-none outline-none text-gray-700 p-0"
                                            />
                                        </div>
                                        <div className="bg-white p-1.5 rounded-md border border-gray-200">
                                            <label className="text-[8px] font-black uppercase text-gray-400 block">Diskon (%)</label>
                                            <input 
                                                type="number" 
                                                value={!item.discount_percent ? '' : item.discount_percent} 
                                                onFocus={(e) => e.target.select()}
                                                placeholder="0"
                                                onChange={(e) => handleCartItemDiscountChange(item.id, item.item_type, e.target.value)}
                                                className="w-full text-[11px] font-bold bg-transparent border-none outline-none text-gray-700 p-0 text-right"
                                                min="0"
                                                max="100"
                                            />
                                        </div>
                                        <div className="bg-white p-1.5 rounded-md border border-gray-200">
                                            <label className="text-[8px] font-black uppercase text-gray-400 block">Potongan (Rp)</label>
                                            {(() => {
                                                const potNom = Math.max(0, (item.original_price || 0) - (item.price || 0))
                                                return (
                                                    <input 
                                                        type="number" 
                                                        value={!potNom ? '' : potNom} 
                                                        onFocus={(e) => e.target.select()}
                                                        placeholder="0"
                                                        onChange={(e) => handleCartItemDiscountNominalChange(item.id, item.item_type, e.target.value)}
                                                        className="w-full text-[11px] font-bold bg-transparent border-none outline-none text-gray-700 p-0 text-right"
                                                        min="0"
                                                    />
                                                )
                                            })()}
                                        </div>
                                        <div className="bg-pink-50/50 p-1.5 rounded-md border border-pink-200">
                                            <label className="text-[8px] font-black uppercase text-pink-600 block">Harga Net</label>
                                            <input 
                                                type="number" 
                                                value={!item.price ? '' : item.price} 
                                                onFocus={(e) => e.target.select()}
                                                placeholder="0"
                                                onChange={(e) => handleCartItemPriceChange(item.id, item.item_type, e.target.value)}
                                                className="w-full text-[11px] font-black bg-transparent border-none outline-none text-ayumi-primary p-0 text-right"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Bottom row: quantity controls & item subtotal */}
                                <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-gray-100">
                                    <div className="flex items-center gap-1.5 bg-gray-50 rounded-lg p-0.5 border border-gray-100">
                                        <button 
                                            type="button"
                                            onClick={() => updateCartQty(item.id, item.item_type, -1)} 
                                            className="w-5 h-5 flex items-center justify-center text-gray-600 bg-white rounded shadow-2xs hover:bg-gray-100 font-black text-xs"
                                        >-</button>
                                        <span className="font-extrabold text-xs w-5 text-center text-gray-800">{item.quantity}</span>
                                        <button 
                                            type="button"
                                            onClick={() => updateCartQty(item.id, item.item_type, 1)} 
                                            className="w-5 h-5 flex items-center justify-center text-gray-600 bg-white rounded shadow-2xs hover:bg-gray-100 font-black text-xs"
                                        >+</button>
                                    </div>
                                    <div className="text-right">
                                        <span className="font-black text-xs text-ayumi-secondary">
                                            Rp {((item.price || 0) * item.quantity).toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* ─── SECTION BOTTOM: TOTALS & PAYMENT COMPACT ─── */}
                <div className="border-t border-slate-200 bg-white p-3.5 shadow-md z-10 shrink-0 space-y-2.5">
                    {/* Subtotal & Diskon Global */}
                    <div className="space-y-1.5 text-xs text-slate-600">
                        <div className="flex justify-between items-center">
                            <span>Subtotal ({cart.reduce((s,i)=>s+(i.quantity||1),0)} item)</span>
                            <span className="font-bold text-slate-800">Rp {subtotal.toLocaleString('id-ID')}</span>
                        </div>
                        
                        <div className="flex items-center justify-between gap-2">
                            <span className="shrink-0">Diskon Nota</span>
                            <div className="flex items-center gap-1 flex-1 max-w-[170px]">
                                <select 
                                    value={discountType} 
                                    onChange={(e) => setDiscountType(e.target.value)}
                                    className="input-ayumi bg-gray-50 py-0.5 px-1.5 text-[11px] w-14 font-bold"
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
                                    className="input-ayumi py-0.5 px-2 text-right flex-1 bg-gray-50 text-xs font-bold"
                                    min="0"
                                />
                            </div>
                        </div>

                        {discountAmount > 0 && (
                            <div className="flex justify-between text-[11px] text-red-500 font-semibold">
                                <span>Potongan Diskon</span>
                                <span>- Rp {discountAmount.toLocaleString('id-ID')}</span>
                            </div>
                        )}

                        {paymentMethod === 'qris' && (
                            <div className="flex justify-between text-[11px] text-blue-700 font-semibold bg-blue-50 p-1.5 rounded-lg">
                                <span>📱 Biaya QRIS (0,3%)</span>
                                <span className="font-bold">+ Rp {qrisFee.toLocaleString('id-ID')}</span>
                            </div>
                        )}
                    </div>

                    {/* TOTAL BAYAR */}
                    <div className="flex justify-between items-center border-t border-slate-100 pt-2">
                        <span className="font-extrabold text-xs text-slate-700 tracking-wider">TOTAL BAYAR</span>
                        <span className="font-black text-xl text-ayumi-secondary tracking-tight">Rp {total.toLocaleString('id-ID')}</span>
                    </div>

                    {/* Selector Terapis Global (Jika tindakan langsung belum punya terapis) */}
                    {cart.some(item => item.item_type === 'treatment' && !item.treatment_record_id && !item.therapist_id) && (
                        <div>
                            <select
                                value={selectedTherapistId}
                                onChange={(e) => setSelectedTherapistId(e.target.value)}
                                className="w-full input-ayumi text-xs font-bold bg-pink-50/50 border-pink-200 py-1"
                            >
                                <option value="">-- Pilih Terapis Tindakan * --</option>
                                <option value="worker">💉 Worker (Tanpa Komisi)</option>
                                {therapists.map(t => (
                                    <option key={t.id} value={t.id}>{t.full_name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Metode Pembayaran (6 Compact Buttons) */}
                    <div>
                        <div className="grid grid-cols-6 gap-1">
                            {[
                                { id: 'cash', label: 'Cash', icon: '💵' },
                                { id: 'transfer', label: 'Bank', icon: '🏦' },
                                { id: 'qris', label: 'QRIS', icon: '📱' },
                                { id: 'debit', label: 'Debit', icon: '💳' },
                                { id: 'credit', label: 'Kredit', icon: '💳' },
                                { id: 'split', label: 'Split', icon: '🔀' }
                            ].map(pm => (
                                <button
                                    key={pm.id}
                                    type="button"
                                    onClick={() => setPaymentMethod(pm.id)}
                                    className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-lg border text-[10px] font-extrabold transition-all cursor-pointer ${
                                        paymentMethod === pm.id
                                            ? 'bg-pink-50 border-ayumi-primary text-ayumi-primary shadow-2xs scale-102'
                                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                >
                                    <span className="text-xs">{pm.icon}</span>
                                    <span className="truncate w-full text-center">{pm.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Split Payment UI */}
                        {paymentMethod === 'split' && (
                            <div className="mt-2 p-2 bg-pink-50/40 border border-pink-200 rounded-xl space-y-1.5 animate-fadeIn">
                                <div className="flex items-center justify-between pb-1 border-b border-pink-100">
                                    <span className="text-[10px] font-black text-ayumi-secondary">🔀 Rincian Split</span>
                                    {(() => {
                                        const cVal = Number(splitAmounts.cash) || 0
                                        const tVal = Number(splitAmounts.transfer) || 0
                                        const qVal = Number(splitAmounts.qris) || 0
                                        const dVal = Number(splitAmounts.debit) || 0
                                        const crVal = Number(splitAmounts.credit) || 0
                                        const currentSum = cVal + tVal + qVal + dVal + crVal
                                        const diff = total - currentSum

                                        if (diff === 0) {
                                            return <span className="text-[9px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded-full">✓ Pas</span>
                                        } else {
                                            return <span className="text-[9px] font-black text-rose-700 bg-rose-100 px-1.5 py-0.2 rounded-full">Kurang: Rp {diff.toLocaleString('id-ID')}</span>
                                        }
                                    })()}
                                </div>
                                <div className="grid grid-cols-2 gap-1.5 text-xs">
                                    <div className="bg-white p-1 rounded-md border border-gray-200 flex items-center gap-1">
                                        <span className="text-[9px] text-gray-500 font-bold">💵 Cash:</span>
                                        <input 
                                            type="number"
                                            value={splitAmounts.cash}
                                            placeholder="0"
                                            onChange={(e) => setSplitAmounts(prev => ({ ...prev, cash: e.target.value }))}
                                            className="w-full font-black text-gray-800 p-0 border-none outline-none text-xs text-right"
                                        />
                                    </div>
                                    <div className="bg-white p-1 rounded-md border border-gray-200 flex items-center gap-1">
                                        <span className="text-[9px] text-gray-500 font-bold">🏦 Bank:</span>
                                        <input 
                                            type="number"
                                            value={splitAmounts.transfer}
                                            placeholder="0"
                                            onChange={(e) => setSplitAmounts(prev => ({ ...prev, transfer: e.target.value }))}
                                            className="w-full font-black text-gray-800 p-0 border-none outline-none text-xs text-right"
                                        />
                                    </div>
                                    <div className="bg-white p-1 rounded-md border border-gray-200 flex items-center gap-1">
                                        <span className="text-[9px] text-gray-500 font-bold">📱 QRIS:</span>
                                        <input 
                                            type="number"
                                            value={splitAmounts.qris}
                                            placeholder="0"
                                            onChange={(e) => setSplitAmounts(prev => ({ ...prev, qris: e.target.value }))}
                                            className="w-full font-black text-gray-800 p-0 border-none outline-none text-xs text-right"
                                        />
                                    </div>
                                    <div className="bg-white p-1 rounded-md border border-gray-200 flex items-center gap-1">
                                        <span className="text-[9px] text-gray-500 font-bold">💳 Debit:</span>
                                        <input 
                                            type="number"
                                            value={splitAmounts.debit}
                                            placeholder="0"
                                            onChange={(e) => setSplitAmounts(prev => ({ ...prev, debit: e.target.value }))}
                                            className="w-full font-black text-gray-800 p-0 border-none outline-none text-xs text-right"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Cash Payment Box (Compact & Sleek) */}
                        {paymentMethod === 'cash' && (
                            <div className="mt-2 p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1.5 animate-fadeIn">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-extrabold text-emerald-950 flex items-center gap-1">
                                        <span>💵</span> Uang Tunai Diterima:
                                    </label>
                                    {(() => {
                                        const cVal = Number(cashReceived) || 0
                                        if (cVal > 0 && cVal >= total) {
                                            const change = cVal - total
                                            return (
                                                <span className="text-[10px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.2 rounded-full border border-emerald-300">
                                                    Kembalian: Rp {change.toLocaleString('id-ID')}
                                                </span>
                                            )
                                        } else if (cVal > 0 && cVal < total) {
                                            return (
                                                <span className="text-[10px] font-black text-rose-700 bg-rose-100 px-2 py-0.2 rounded-full">
                                                    Kurang: Rp {(total - cVal).toLocaleString('id-ID')}
                                                </span>
                                            )
                                        }
                                        return null
                                    })()}
                                </div>

                                <div className="flex items-center gap-1.5">
                                    <div className="relative flex-1">
                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-600">Rp</span>
                                        <input
                                            type="number"
                                            value={cashReceived}
                                            onChange={(e) => setCashReceived(e.target.value)}
                                            onFocus={(e) => e.target.select()}
                                            placeholder={total ? total.toString() : '0'}
                                            className="w-full pl-8 pr-2.5 py-1 bg-white border border-emerald-300 rounded-lg text-sm font-black text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-right"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setCashReceived(total.toString())}
                                        className="px-2.5 py-1 text-[10px] font-black bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-2xs shrink-0 cursor-pointer"
                                    >
                                        ✓ Uang Pas
                                    </button>
                                </div>

                                {/* Quick Cash Chips (Tight Wrap) */}
                                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                    {[50000, 100000, 200000, 500000].map(val => (
                                        <button
                                            key={val}
                                            type="button"
                                            onClick={() => setCashReceived(val.toString())}
                                            className="px-2 py-0.5 text-[9px] font-bold bg-white border border-emerald-200 text-emerald-800 rounded-md hover:bg-emerald-100 transition-colors cursor-pointer"
                                        >
                                            Rp {val.toLocaleString('id-ID')}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Tombol Aksi Bawah: PROSES & SIMPAN TAGIHAN */}
                    <div className="flex items-center gap-2 pt-1">
                        {(cart.length > 0 || selectedPatient) && (
                            <button
                                type="button"
                                onClick={handleHoldTransaction}
                                className="px-3 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1 shadow-2xs cursor-pointer shrink-0 transition-all"
                                title="Simpan / Tahan tagihan ini agar bisa melayani pelanggan lain"
                            >
                                <span>⏸️</span>
                                <span className="hidden sm:inline">Simpan</span>
                            </button>
                        )}
                        <button 
                            type="button"
                            onClick={handleCheckout}
                            disabled={isProcessing || cart.length === 0 || !selectedBranch}
                            className="flex-1 bg-ayumi-primary hover:bg-ayumi-primary-hover disabled:opacity-50 disabled:pointer-events-none text-white py-2.5 rounded-xl text-xs sm:text-sm font-black tracking-wider flex justify-center items-center gap-2 shadow-md shadow-pink-500/20 active:scale-[0.99] transition-all cursor-pointer"
                        >
                            {isProcessing ? (
                                <span className="animate-pulse">Memproses...</span>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                                    PROSES PEMBAYARAN
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════ */}
            {/* MODAL: DAFTAR TRANSAKSI TERTAHAN (HELD DRAFTS)   */}
            {/* ═══════════════════════════════════════════════════ */}
            {isHeldModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
                    <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-gray-100 flex flex-col max-h-[85vh] animate-scaleUp">
                        {/* Header */}
                        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                            <div className="flex items-center gap-2.5">
                                <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center text-lg font-bold">
                                    📂
                                </div>
                                <div>
                                    <h3 className="font-extrabold text-base text-gray-900">Daftar Transaksi Tertahan</h3>
                                    <p className="text-xs text-gray-500 font-medium">Buka kembali transaksi pelanggan yang disimpan sementara</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsHeldModalOpen(false)}
                                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Body / List */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar py-4 space-y-3">
                            {heldTransactions.length === 0 ? (
                                <div className="text-center py-12 text-gray-400">
                                    <span className="text-4xl block mb-2">📭</span>
                                    <p className="text-sm font-semibold">Tidak ada transaksi yang sedang ditahan</p>
                                </div>
                            ) : (
                                heldTransactions.map((heldItem) => {
                                    const itemCount = heldItem.cart?.reduce((sum, item) => sum + (item.quantity || 1), 0) || 0
                                    const heldDate = new Date(heldItem.heldAt)
                                    const timeStr = heldDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                                    const dateStr = heldDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })

                                    return (
                                        <div
                                            key={heldItem.id}
                                            className="p-4 bg-gradient-to-r from-pink-50/30 via-white to-amber-50/20 border border-gray-200 hover:border-ayumi-primary rounded-2xl transition-all shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                                        >
                                            <div className="space-y-1.5 min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-extrabold text-sm text-gray-900 truncate">
                                                        {heldItem.patient?.full_name || 'Pelanggan Walk-in'}
                                                    </span>
                                                    <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                                                        ⏰ {timeStr} ({dateStr})
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 truncate">
                                                    {heldItem.patient?.whatsapp ? `📞 ${heldItem.patient.whatsapp}` : 'Tanpa No. HP'}
                                                </p>
                                                <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 flex-wrap pt-0.5">
                                                    <span className="bg-gray-100 px-2 py-0.5 rounded-md text-[11px]">
                                                        🛍️ {itemCount} Item
                                                    </span>
                                                    <span className="font-black text-ayumi-secondary text-sm">
                                                        Rp {(heldItem.totalAmount || 0).toLocaleString('id-ID')}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                                <button
                                                    type="button"
                                                    onClick={() => handleRestoreHeldTransaction(heldItem)}
                                                    className="px-3.5 py-2 bg-ayumi-primary hover:bg-ayumi-primary-hover text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                                                >
                                                    <span>▶️</span>
                                                    <span>Lanjutkan</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleDeleteHeldTransaction(heldItem.id, e)}
                                                    className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer border border-gray-100 hover:border-rose-200"
                                                    title="Hapus draft ini"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>

                        {/* Footer */}
                        <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                            <span>Draft tersimpan aman di browser kasir</span>
                            <button
                                type="button"
                                onClick={() => setIsHeldModalOpen(false)}
                                className="font-bold text-gray-700 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                            >
                                Tutup
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Item Variant & Quantity Selection Modal */}
            <ItemVariantModal
                isOpen={isItemModalOpen}
                item={selectedCatalogItem}
                itemType={selectedItemType}
                onClose={handleCloseItemModal}
                onConfirm={handleConfirmModalSelection}
            />
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
