'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { toast } from 'react-hot-toast'

// Helper to convert an image URL to a base64 string
const getBase64ImageFromUrl = async (url) => {
    const res = await fetch(url)
    const blob = await res.blob()
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

export default function RecordDetailPage() {
    const params = useParams()
    const id = params.id
    const router = useRouter()

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [record, setRecord] = useState(null)
    const [items, setItems] = useState([])
    const [photoUrls, setPhotoUrls] = useState({
        before_depan: null,
        before_kiri: null,
        before_kanan: null,
        after_depan: null,
        after_kiri: null,
        after_kanan: null,
        foto_depan: null,
        foto_kiri: null,
        foto_kanan: null
    })
    const [isLoading, setIsLoading] = useState(true)
    const [isOwner, setIsOwner] = useState(false)
    const [userRole, setUserRole] = useState(null)

    const handleDeleteRecord = async () => {
        if (!window.confirm('Apakah Anda yakin ingin menghapus rekam medis ini? Semua data terkait (termasuk antrean followup dan item rekam medis) akan dihapus, dan kupon yang digunakan akan dikembalikan.')) {
            return
        }

        try {
            // 1. Fetch coupon logs related to this treatment record to rollback coupon sessions
            const { data: logs } = await supabase
                .from('coupon_usage_logs')
                .select('*')
                .eq('treatment_record_id', id)

            if (logs && logs.length > 0) {
                for (const log of logs) {
                    const { data: itemData } = await supabase
                        .from('patient_coupon_items')
                        .select('used_sessions, remaining_sessions, patient_coupon_id')
                        .eq('id', log.patient_coupon_item_id)
                        .single()

                    if (itemData) {
                        const newUsed = Math.max(0, itemData.used_sessions - 1)
                        const newRemaining = itemData.remaining_sessions + 1
                        
                        await supabase
                            .from('patient_coupon_items')
                            .update({
                                used_sessions: newUsed,
                                remaining_sessions: newRemaining,
                                status: 'active'
                            })
                            .eq('id', log.patient_coupon_item_id)

                        await supabase
                            .from('patient_coupons')
                            .update({ status: 'active' })
                            .eq('id', itemData.patient_coupon_id)
                    }
                }

                await supabase
                    .from('coupon_usage_logs')
                    .delete()
                    .eq('treatment_record_id', id)
            }

            // 2. Delete followup reminders
            await supabase
                .from('followup_queue')
                .delete()
                .eq('treatment_record_id', id)

            // 3. Delete record items
            await supabase
                .from('treatment_record_items')
                .delete()
                .eq('treatment_record_id', id)

            // 4. Delete patient photos
            await supabase
                .from('patient_photos')
                .delete()
                .eq('treatment_record_id', id)

            // 5. Delete the treatment record
            const { error: deleteErr } = await supabase
                .from('treatment_records')
                .delete()
                .eq('id', id)

            if (deleteErr) throw deleteErr

            toast.success('Rekam medis berhasil dihapus.')
            router.push('/treatment-records')
            router.refresh()

        } catch (err) {
            console.error('Error deleting record:', err)
            alert('Gagal menghapus rekam medis: ' + err.message)
        }
    }

    useEffect(() => {
        if (!id) return

        const fetchDetails = async () => {
            setIsLoading(true)

            // 0. Fetch user role
            const { data: { user } } = await supabase.auth.getUser()
            let userRoleVal = null
            let userBranchIdVal = null
            if (user) {
                const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
                if (userData) {
                    userRoleVal = userData.role
                    userBranchIdVal = userData.branch_id
                    setUserRole(userData.role)
                    setIsOwner(userData.role === 'owner')
                } else {
                    setIsOwner(true)
                }
            } else {
                router.push('/login')
                return
            }

            // 1. Fetch Record with nested Patient, Provider, and Branch
            const { data: recData, error: recErr } = await supabase
                .from('treatment_records')
                .select(`
                    *,
                    patients ( id, full_name, whatsapp, birth_date ),
                    users:users!treatment_records_performed_by_fkey ( id, full_name, role ),
                    branches ( id, name )
                `)
                .eq('id', id)
                .single()

            if (recErr || !recData) {
                alert('Data rekam medis tidak ditemukan.')
                router.push('/treatment-records')
                return
            }

            // Guard check for admin
            if (userRoleVal === 'admin' && recData.branch_id !== userBranchIdVal) {
                toast.error('Anda tidak memiliki izin untuk melihat rekam medis dari cabang lain.')
                router.push('/treatment-records')
                return
            }
            setRecord(recData)

            // 2. Fetch Record Items (Treatments)
            const { data: itemsData } = await supabase
                .from('treatment_record_items')
                .select(`
                    *,
                    treatments ( * )
                `)
                .eq('treatment_record_id', id)
                .order('sort_order', { ascending: true })

            if (itemsData) setItems(itemsData)

            // 3. Fetch Photos and Generate Signed URLs
            const { data: photosData } = await supabase
                .from('patient_photos')
                .select('*')
                .eq('treatment_record_id', id)

            if (photosData && photosData.length > 0) {
                const urls = {}
                for (const photo of photosData) {
                    const { data: signedData, error: signedErr } = await supabase.storage
                        .from('patient-photos')
                        .createSignedUrl(photo.storage_path, 60 * 60) // valid for 1 hour

                    if (signedData && !signedErr) {
                        const key = photo.caption || photo.storage_path.split('/').pop().split('.')[0]
                        urls[key] = signedData.signedUrl
                    } else {
                        console.error('Failed to sign URL for:', photo.storage_path, signedErr)
                    }
                }
                setPhotoUrls(prev => ({ ...prev, ...urls }))
            }

            setIsLoading(false)
        }

        fetchDetails()
    }, [id, supabase, router])

    const handleSendWhatsApp = async () => {
        const toastId = toast.loading('Menyiapkan dokumen PDF...')
        try {
            const { jsPDF } = await import('jspdf')

            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            })

            let y = 15

            // --- HEADER PDF ---
            doc.setFillColor(212, 98, 33) // #D46221 (Ayumi Primary)
            doc.rect(15, y, 180, 8, 'F')
            y += 15

            doc.setFont('helvetica', 'bold')
            doc.setFontSize(22)
            doc.setTextColor(78, 42, 18) // #4E2A12 (Ayumi Secondary)
            doc.text('AYUMI BEAUTY HOUSE', 15, y)
            
            doc.setFontSize(10)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(120, 120, 120)
            doc.text(`Cabang: ${record.branches?.name || 'Pusat'}`, 15, y + 5)
            doc.text(`Tanggal Rekam Medis: ${new Date(record.created_at).toLocaleDateString('id-ID')}`, 15, y + 10)
            y += 18

            // Separator Line
            doc.setDrawColor(240, 240, 240)
            doc.setLineWidth(0.5)
            doc.line(15, y, 195, y)
            y += 10

            // --- IDENTITY & TREATMENT INFO ---
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(14)
            doc.setTextColor(78, 42, 18)
            doc.text('INFORMASI PASIEN & TINDAKAN', 15, y)
            y += 8

            doc.setFont('helvetica', 'normal')
            doc.setFontSize(10)
            doc.setTextColor(50, 50, 50)

            const col1X = 15
            const col2X = 110

            // Patient Name
            doc.setFont('helvetica', 'bold')
            doc.text('Nama Pasien:', col1X, y)
            doc.setFont('helvetica', 'normal')
            doc.text(record.patients?.full_name || '-', col1X + 35, y)

            // Date of Action
            doc.setFont('helvetica', 'bold')
            doc.text('Tanggal Tindakan:', col2X, y)
            doc.setFont('helvetica', 'normal')
            doc.text(new Date(record.treatment_date).toLocaleDateString('id-ID'), col2X + 38, y)
            y += 6

            // Date of Birth
            doc.setFont('helvetica', 'bold')
            doc.text('Tanggal Lahir:', col1X, y)
            doc.setFont('helvetica', 'normal')
            const bdate = record.patients?.birth_date ? new Date(record.patients.birth_date).toLocaleDateString('id-ID') : '-'
            doc.text(bdate, col1X + 35, y)

            // Therapist / Provider Name
            doc.setFont('helvetica', 'bold')
            doc.text('Terapis / Dokter:', col2X, y)
            doc.setFont('helvetica', 'normal')
            doc.text(record.users?.full_name || '-', col2X + 38, y)
            y += 6

            // WhatsApp Number
            doc.setFont('helvetica', 'bold')
            doc.text('No. WhatsApp:', col1X, y)
            doc.setFont('helvetica', 'normal')
            doc.text(record.patients?.whatsapp || '-', col1X + 35, y)
            y += 12

            // --- SOAP NOTES ---
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(78, 42, 18)
            doc.setFontSize(12)
            doc.text('CATATAN MEDIS (SOAP)', 15, y)
            y += 6

            const soapFields = [
                { label: 'Subjektif (Keluhan)', value: record.complaints || '-' },
                { label: 'Objektif (Kondisi Kulit)', value: record.skin_condition || '-' },
                { label: 'Asesmen (Tindakan & Hasil)', value: record.result_notes || '-' },
                { label: 'Planning (Rekomendasi)', value: record.recommendation || '-' }
            ]

            doc.setFontSize(10)
            for (const field of soapFields) {
                const splitText = doc.splitTextToSize(field.value, 180)
                const sectionHeight = 5 + (splitText.length * 5) + 5
                if (y + sectionHeight > 280) {
                    doc.addPage()
                    y = 15
                }

                doc.setFont('helvetica', 'bold')
                doc.setTextColor(78, 42, 18)
                doc.text(field.label + ':', 15, y)
                y += 5

                doc.setFont('helvetica', 'normal')
                doc.setTextColor(70, 70, 70)
                doc.text(splitText, 15, y)
                y += splitText.length * 5 + 4
            }
            y += 6

            // --- TREATMENT DETAILS TABLE ---
            if (y + 40 > 280) {
                doc.addPage()
                y = 15
            }

            doc.setFont('helvetica', 'bold')
            doc.setTextColor(78, 42, 18)
            doc.setFontSize(12)
            doc.text('RINCIAN TINDAKAN & BIAYA', 15, y)
            y += 6

            // Draw table header
            doc.setFillColor(245, 245, 245)
            doc.rect(15, y, 180, 8, 'F')
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(9)
            doc.setTextColor(78, 42, 18)
            doc.text('No', 17, y + 5.5)
            doc.text('Treatment / Produk', 27, y + 5.5)
            doc.text('Harga Asli', 102, y + 5.5)
            doc.text('Diskon', 132, y + 5.5)
            doc.text('Total Bayar', 167, y + 5.5)
            y += 8

            // Draw table rows
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(9)
            doc.setTextColor(50, 50, 50)
            items.forEach((item, idx) => {
                // Page overflow check
                if (y + 12 > 280) {
                    doc.addPage()
                    y = 15
                    // Redraw header on new page
                    doc.setFillColor(245, 245, 245)
                    doc.rect(15, y, 180, 8, 'F')
                    doc.setFont('helvetica', 'bold')
                    doc.setFontSize(9)
                    doc.setTextColor(78, 42, 18)
                    doc.text('No', 17, y + 5.5)
                    doc.text('Treatment / Produk', 27, y + 5.5)
                    doc.text('Harga Asli', 102, y + 5.5)
                    doc.text('Diskon', 132, y + 5.5)
                    doc.text('Total Bayar', 167, y + 5.5)
                    y += 8
                    doc.setFont('helvetica', 'normal')
                    doc.setFontSize(9)
                    doc.setTextColor(50, 50, 50)
                }

                const name = item.treatments?.name || 'Unknown'
                const origPrice = item.original_price || item.price_at_time || 0
                const finalPrice = item.price_at_time || 0
                const discountAmt = origPrice - finalPrice
                const discountPercent = item.discount_percent || 0

                let discountStr = '-'
                if (discountPercent > 0 || discountAmt > 0) {
                    discountStr = `${discountPercent}% (Rp ${discountAmt.toLocaleString('id-ID')})`
                }

                doc.text(String(idx + 1), 17, y + 5.5)
                doc.text(name, 27, y + 5.5, { maxWidth: 70 })
                doc.text(`Rp ${origPrice.toLocaleString('id-ID')}`, 102, y + 5.5)
                doc.text(discountStr, 132, y + 5.5)
                doc.text(`Rp ${finalPrice.toLocaleString('id-ID')}`, 167, y + 5.5)

                // fine line
                doc.setDrawColor(240, 240, 240)
                doc.line(15, y + 8, 195, y + 8)
                y += 8
            })

            // Draw grand total
            if (y + 12 > 280) {
                doc.addPage()
                y = 15
            }
            doc.setFont('helvetica', 'bold')
            doc.text('Total:', 132, y + 5.5)
            const grandTotal = items.reduce((acc, curr) => acc + Number(curr.price_at_time || 0), 0)
            doc.text(`Rp ${grandTotal.toLocaleString('id-ID')}`, 167, y + 5.5)
            y += 12

            // --- FOTO GRID ---
            const hasNewPhotos = photoUrls.foto_depan || photoUrls.foto_kiri || photoUrls.foto_kanan
            const hasOldPhotos = photoUrls.before_depan || photoUrls.before_kiri || photoUrls.before_kanan || photoUrls.after_depan || photoUrls.after_kiri || photoUrls.after_kanan

            const isOldLayout = hasOldPhotos && !hasNewPhotos

            doc.setFont('helvetica', 'bold')
            doc.setTextColor(78, 42, 18)
            doc.setFontSize(12)
            doc.text(isOldLayout ? 'DOKUMENTASI FOTO (BEFORE - AFTER)' : 'DOKUMENTASI FOTO TREATMENT', 15, y)
            y += 8

            const slots = isOldLayout ? [
                { key: 'before_depan', label: 'Before Depan' },
                { key: 'before_kiri', label: 'Before Kiri' },
                { key: 'before_kanan', label: 'Before Kanan' },
                { key: 'after_depan', label: 'After Depan' },
                { key: 'after_kiri', label: 'After Kiri' },
                { key: 'after_kanan', label: 'After Kanan' }
            ] : [
                { key: 'foto_depan', label: 'Foto Depan' },
                { key: 'foto_kiri', label: 'Foto Samping Kiri' },
                { key: 'foto_kanan', label: 'Foto Samping Kanan' }
            ]

            const imgWidth = 55
            const imgHeight = 40
            const spacingX = 8
            const startX = 15

            const totalRows = isOldLayout ? 2 : 1

            for (let row = 0; row < totalRows; row++) {
                if (y + imgHeight + 12 > 280) {
                    doc.addPage()
                    y = 15
                }

                for (let col = 0; col < 3; col++) {
                    const idx = row * 3 + col
                    if (idx >= slots.length) break
                    const slot = slots[idx]
                    const currentX = startX + col * (imgWidth + spacingX)

                    // Label above image
                    doc.setFont('helvetica', 'bold')
                    doc.setFontSize(8)
                    doc.setTextColor(120, 120, 120)
                    doc.text(slot.label, currentX, y)

                    // Box outline
                    doc.setDrawColor(220, 220, 220)
                    doc.rect(currentX, y + 2, imgWidth, imgHeight)

                    if (photoUrls[slot.key]) {
                        try {
                            const base64Data = await getBase64ImageFromUrl(photoUrls[slot.key])
                            let format = 'JPEG'
                            if (base64Data.includes('image/png')) format = 'PNG'
                            else if (base64Data.includes('image/webp')) format = 'WEBP'
                            
                            doc.addImage(base64Data, format, currentX, y + 2, imgWidth, imgHeight)
                        } catch (err) {
                            console.error(`Error adding PDF image for ${slot.key}:`, err)
                            doc.setFontSize(8)
                            doc.setTextColor(150, 150, 150)
                            doc.text('Gagal memuat', currentX + 15, y + imgHeight / 2 + 2)
                        }
                    } else {
                        doc.setFontSize(8)
                        doc.setTextColor(150, 150, 150)
                        doc.text('Tidak ada foto', currentX + 15, y + imgHeight / 2 + 2)
                    }
                }
                y += imgHeight + 10
            }

            // --- FOOTER ---
            y = 280
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(9)
            doc.setTextColor(212, 98, 33)
            doc.text('Ayumi Beauty House', 15, y)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(120, 120, 120)
            doc.text('Instagram: @ayumibeautyhouse', 135, y)

            // PDF Filename format: [NamaPasien]_[Tanggal].pdf
            const patientName = (record.patients?.full_name || 'Pasien').replace(/[^a-zA-Z0-9]/g, '_')
            const dateStr = record.treatment_date
            const filename = `${patientName}_${dateStr}.pdf`

            doc.save(filename)
            toast.success('PDF berhasil terdownload!', { id: toastId })

            // Open WhatsApp Web in a new tab
            let waNumber = record.patients?.whatsapp || ''
            waNumber = waNumber.replace(/[^0-9]/g, '')
            if (waNumber.startsWith('0')) {
                waNumber = '62' + waNumber.substring(1)
            }

            const waUrl = `https://wa.me/${waNumber}`
            window.open(waUrl, '_blank')

            alert(`PDF "${filename}" sudah terdownload.\nSilakan attach file PDF tersebut ke WhatsApp yang sudah terbuka.`)

        } catch (err) {
            console.error('Error generating PDF:', err)
            toast.error('Gagal generate PDF: ' + err.message, { id: toastId })
        }
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="inline-block animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                <p className="text-ayumi-primary font-semibold">Memuat rekam medis...</p>
            </div>
        )
    }

    if (!record) return null

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            
            {/* Top Navigation & WhatsApp Button */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
                <div className="flex items-center gap-4">
                    <Link href={`/patients/${record.patient_id}`}>
                        <button className="text-ayumi-secondary hover:text-ayumi-primary bg-white p-2.5 rounded-full shadow-sm transition-colors border border-gray-100">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        </button>
                    </Link>
                    <span className="text-gray-500 font-medium">Kembali ke Profil Pasien</span>
                </div>
                
                    {(isOwner || userRole === 'admin') && (
                        <div className="flex flex-wrap gap-2 items-center">
                            {/* Tombol Proses di Kasir — langsung atur diskon & produk tanpa edit */}
                            <Link href={`/kasir?pendingRecordId=${record.id}`}>
                                <button className="bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 shadow-md hover:shadow-lg">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                                    Proses di Kasir
                                </button>
                            </Link>
                            <Link href={`/treatment-records/${record.id}/edit`}>
                                <button className="bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 px-4 py-2.5 rounded-xl font-bold text-sm transition-colors flex items-center gap-1.5 shadow-sm">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                    Edit
                                </button>
                            </Link>
                            <button
                                onClick={handleDeleteRecord}
                                className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 px-4 py-2.5 rounded-xl font-bold text-sm transition-colors flex items-center gap-1.5 shadow-sm"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                Hapus
                            </button>
                            <button
                                onClick={handleSendWhatsApp}
                                className="btn-primary py-2.5 px-5 flex items-center gap-2 text-sm font-bold shadow-md hover:shadow-lg transition-all"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                                Kirim ke WhatsApp Pasien
                            </button>
                        </div>
                    )}
            </div>

            {/* Header Identity */}
            <div className="card-ayumi p-5 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-pink-100 rounded-2xl flex items-center justify-center text-ayumi-primary">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <div>
                        <h1 className="text-2xl font-extrabold text-ayumi-secondary mb-1">
                            {record.patients?.full_name || 'Unknown Patient'}
                        </h1>
                        <p className="text-sm font-medium text-gray-500">
                            {new Date(record.treatment_date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} 
                            &nbsp;•&nbsp; {record.treatment_time || '-'} &nbsp;•&nbsp; Cabang {record.branches?.name || 'Pusat'}
                        </p>
                    </div>
                </div>
                <div className="bg-gray-50 px-5 py-3 rounded-xl border border-gray-100 text-right">
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">Dilakukan Oleh</p>
                    <p className="font-bold text-ayumi-secondary">{record.users?.full_name || 'Tidak ada data dokter'}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Kolom Kiri: Rekam Medis (SOAP) */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="card-ayumi p-4 md:p-6 space-y-5">
                        <h3 className="text-lg font-bold text-ayumi-primary border-b border-pink-50 pb-2">Rekam Medis (SOAP)</h3>
                        
                        <div className="space-y-4">
                            <div>
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Subjektif (Keluhan)</h4>
                                <p className="text-sm font-semibold text-gray-800 whitespace-pre-wrap leading-relaxed">
                                    {record.complaints || '-'}
                                </p>
                            </div>
                            
                            <div>
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Objektif (Kondisi Kulit)</h4>
                                <p className="text-sm font-semibold text-gray-800 whitespace-pre-wrap leading-relaxed">
                                    {record.skin_condition || '-'}
                                </p>
                            </div>
                            
                            <div>
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Asesmen (Tindakan & Hasil)</h4>
                                <p className="text-sm font-semibold text-gray-800 whitespace-pre-wrap leading-relaxed">
                                    {record.result_notes || '-'}
                                </p>
                            </div>
                            
                            <div>
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Planning (Rekomendasi)</h4>
                                <p className="text-sm font-semibold text-gray-800 whitespace-pre-wrap leading-relaxed">
                                    {record.recommendation || '-'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Kolom Rincian Tindakan & Foto Grid */}
                <div className="lg:col-span-2 space-y-6">
                    
                    {/* Daftar Item Treatment */}
                    <div className="card-ayumi p-4 md:p-6">
                        <h3 className="text-lg font-bold text-ayumi-secondary border-b border-gray-100 pb-3 mb-4">Rincian Tindakan (Treatment)</h3>
                        
                        {items.length === 0 ? (
                            <p className="text-gray-400 italic text-sm text-center py-4">Tidak ada data rincian treatment.</p>
                        ) : (
                            <div className="space-y-3">
                                {items.map((item, idx) => {
                                    const hasDiscount = item.discount_percent > 0 && userRole !== 'therapist';
                                    return (
                                        <div key={item.id} className="flex justify-between items-center bg-gray-50 p-4 rounded-2xl border border-gray-100">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-white font-bold text-ayumi-primary shadow-sm flex items-center justify-center text-xs">
                                                    {idx + 1}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-ayumi-secondary">{item.treatments?.name || 'Unknown'}</p>
                                                    {hasDiscount && (
                                                        <div className="flex items-center gap-1.5 mt-0.5 text-xs">
                                                            <span className="line-through text-gray-400">Rp {item.original_price?.toLocaleString('id-ID')}</span>
                                                            <span className="bg-pink-50 text-ayumi-primary font-bold px-1.5 py-0.5 rounded text-[10px]">
                                                                -{item.discount_percent}%
                                                            </span>
                                                        </div>
                                                    )}
                                                    {item.notes && <p className="text-xs text-gray-500 mt-0.5">{item.notes}</p>}
                                                </div>
                                            </div>
                                            {userRole !== 'therapist' && (
                                                <div className="font-bold text-gray-800 text-right">
                                                    Rp {Number(item.price_at_time).toLocaleString('id-ID')}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {userRole !== 'therapist' && (
                                    <div className="flex justify-between items-center p-4">
                                        <p className="font-bold text-gray-500 uppercase tracking-wider text-sm">Total Biaya</p>
                                        <p className="text-xl font-extrabold text-ayumi-primary">
                                            Rp {items.reduce((acc, curr) => acc + Number(curr.price_at_time), 0).toLocaleString('id-ID')}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Galeri Before After Structured */}
                    <div className="card-ayumi p-4 md:p-6">
                        <h3 className="text-lg font-bold text-ayumi-secondary border-b border-gray-100 pb-3 mb-6">Foto Dokumentasi</h3>
                        
                        {!(photoUrls.before_depan || photoUrls.before_kiri || photoUrls.before_kanan || photoUrls.after_depan || photoUrls.after_kiri || photoUrls.after_kanan) ? (
                            /* New Layout: 3 Photos */
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {[
                                    { key: 'foto_depan', label: 'Depan' },
                                    { key: 'foto_kiri', label: 'Samping Kiri' },
                                    { key: 'foto_kanan', label: 'Samping Kanan' }
                                ].map(slot => (
                                    <div key={slot.key} className="bg-gray-50 rounded-xl p-3 border border-gray-100 text-center">
                                        <span className="text-xs font-bold text-gray-500 block mb-2">{slot.label}</span>
                                        {photoUrls[slot.key] ? (
                                            <img src={photoUrls[slot.key]} alt={slot.label} className="w-full h-32 object-cover rounded-lg shadow-sm" />
                                        ) : (
                                            <div className="h-32 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-xs font-semibold">Tidak ada foto</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            /* Legacy/Fallback Layout: Before-After 6 Photos */
                            <div className="space-y-6">
                                {/* Before Section */}
                                <div>
                                    <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 bg-pink-50 text-ayumi-primary px-3 py-1 rounded-md inline-block">BEFORE</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        {[
                                            { key: 'before_depan', label: 'Depan' },
                                            { key: 'before_kiri', label: 'Samping Kiri' },
                                            { key: 'before_kanan', label: 'Samping Kanan' }
                                        ].map(slot => (
                                            <div key={slot.key} className="bg-gray-50 rounded-xl p-3 border border-gray-100 text-center">
                                                <span className="text-xs font-bold text-gray-500 block mb-2">{slot.label}</span>
                                                {photoUrls[slot.key] ? (
                                                    <img src={photoUrls[slot.key]} alt={`Before ${slot.label}`} className="w-full h-32 object-cover rounded-lg shadow-sm" />
                                                ) : (
                                                    <div className="h-32 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-xs font-semibold">Tidak ada foto</div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* After Section */}
                                <div>
                                    <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 bg-purple-50 text-ayumi-secondary px-3 py-1 rounded-md inline-block">AFTER</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        {[
                                            { key: 'after_depan', label: 'Depan' },
                                            { key: 'after_kiri', label: 'Samping Kiri' },
                                            { key: 'after_kanan', label: 'Samping Kanan' }
                                        ].map(slot => (
                                            <div key={slot.key} className="bg-gray-50 rounded-xl p-3 border border-gray-100 text-center">
                                                <span className="text-xs font-bold text-gray-500 block mb-2">{slot.label}</span>
                                                {photoUrls[slot.key] ? (
                                                    <img src={photoUrls[slot.key]} alt={`After ${slot.label}`} className="w-full h-32 object-cover rounded-lg shadow-sm" />
                                                ) : (
                                                    <div className="h-32 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-xs font-semibold">Tidak ada foto</div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    )
}
