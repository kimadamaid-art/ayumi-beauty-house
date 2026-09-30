'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { supabase } from '@/lib/supabaseClient'
import { toLocalYYYYMMDD } from '@/lib/localDate'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import { openWhatsApp } from '@/lib/whatsapp'

// Tab CRM "Target Treatment": pasien yang pernah mengambil treatment tertentu, untuk
// aftercare, pengingat perawatan ulang, dan re-engagement. Daftar diolah di database oleh
// fungsi crm_treatment_targets (supabase/migrations/20261001_crm_treatment_targets*.sql)
// dan diambil per halaman, jadi treatment yang sangat populer pun tetap ringan.

const PAGE_SIZE = 50
const DAY_MS = 1000 * 60 * 60 * 24

// Treatment bernama paket ("PRP 3X", "Infused Whitening 6x") adalah penjualan kupon hasil
// migrasi GD, bukan tindakan. Fungsi database juga mengabaikannya.
const PACKAGE_NAME_RE = /\d+\s*x\s*$/i

const STAGES = [
    { id: 'due', label: 'Sudah waktunya perawatan ulang (sesuai jadwal treatment)', template: 'recall' },
    { id: 'aftercare', label: 'H+3 s/d H+7 (Aftercare & Cek Kondisi)', min: 3, max: 7, template: 'aftercare' },
    { id: 'recall', label: 'H+14 s/d H+30 (Jadwal Perawatan Ulang)', min: 14, max: 30, template: 'recall' },
    { id: 'reengage', label: '> 45 Hari (Belum Treatment Ulang)', min: 46, template: 'promo' },
    { id: 'all', label: 'Semua Waktu' },
    { id: 'custom', label: 'Rentang Tanggal Kustom' }
]

const TEMPLATES = {
    aftercare: {
        label: 'Aftercare & Cek Kondisi',
        text: 'Halo Kak {nama_pasien} ✨ Salam hangat dari Ayumi Beauty House {cabang}. Bagaimana kondisi kulit Kakak setelah treatment {nama_treatment} pada {tanggal_treatment} kemarin? Apakah kulit terasa lebih segar atau ada yang ingin dikonsultasikan? Jangan lupa perbanyak minum air putih dan rutin pakai sunscreen ya Kak. Semoga harinya menyenangkan! 🥰'
    },
    recall: {
        label: 'Perawatan Ulang / Recall',
        text: 'Halo Kak {nama_pasien} ✨ Sudah {hari_lalu} hari sejak treatment {nama_treatment} terakhir di Ayumi Beauty House {cabang}. Agar hasil perawatannya tetap maksimal dan kulit tetap glowing, yuk jadwalkan sesi perawatan ulang minggu ini. Kakak ada rencana reservasi untuk hari apa? Biar kami bantu amankan slot terapisnya ya Kak 💆‍♀️'
    },
    promo: {
        label: 'Re-engagement / Promo',
        text: 'Halo Kak {nama_pasien} ✨ Salam dari Ayumi Beauty House {cabang}. Kami perhatikan sudah cukup lama sejak terakhir Kakak melakukan treatment {nama_treatment}. Apakah kulitnya masih terawat atau sudah mulai butuh booster nih Kak? Khusus untuk Kakak, minggu ini kami ada penawaran perawatan kembali dengan free konsultasi. Yuk reservasi jadwal perawatan Kakak sebelum slotnya penuh! 🥰'
    }
}

const OUTCOMES = [
    { id: 'no_response', label: 'Terkirim / Belum Dibalas' },
    { id: 'responded', label: 'Dibalas' },
    { id: 'booked', label: 'Langsung Booking' },
    { id: 'not_interested', label: 'Tidak Tertarik' },
    { id: 'wrong_number', label: 'Nomor Salah' }
]
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map(o => [o.id, o.label]))

function formatDay(value) {
    if (!value) return '-'
    const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
    if (isNaN(d.getTime())) return '-'
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysAgoLabel(days) {
    if (days === null || days === undefined) return ''
    if (days <= 0) return 'hari ini'
    if (days === 1) return 'kemarin'
    return `${days} hari lalu`
}

// Selisih hari antara tanggal (YYYY-MM-DD) dan hari ini, menurut kalender lokal.
function daysBetween(fromStr, toStr) {
    return Math.round((new Date(`${toStr}T00:00:00`) - new Date(`${fromStr}T00:00:00`)) / DAY_MS)
}

function templateForRow(stageId, daysSince) {
    const stage = STAGES.find(s => s.id === stageId)
    if (stage?.template) return stage.template
    if (daysSince <= 7) return 'aftercare'
    if (daysSince <= 45) return 'recall'
    return 'promo'
}

function fillTemplate(key, row) {
    // Nama cabang tersimpan sebagai "Ayumi Banjar"; template sudah memuat "Ayumi Beauty House".
    const cabang = (row.branch_name || '').replace(/^ayumi\s+/i, '')
    return TEMPLATES[key].text
        .replaceAll('{nama_pasien}', row.full_name || '')
        .replaceAll('{cabang}', cabang)
        .replaceAll('{nama_treatment}', row.last_treatment_name || '')
        .replaceAll('{tanggal_treatment}', formatDay(row.last_treatment_date))
        .replaceAll('{hari_lalu}', String(row.days_since ?? ''))
}

export default function TreatmentTargetTab({ isOwner, userBranchId, branches, user }) {
    // Master treatment untuk dropdown.
    const [treatments, setTreatments] = useState([])
    const [showInactive, setShowInactive] = useState(false)
    const [pickerOpen, setPickerOpen] = useState(false)
    const [pickerSearch, setPickerSearch] = useState('')
    const pickerRef = useRef(null)

    // Filter
    const [selectedIds, setSelectedIds] = useState([])
    const [stage, setStage] = useState('due')
    const [customStart, setCustomStart] = useState('')
    const [customEnd, setCustomEnd] = useState(() => toLocalYYYYMMDD())
    const [branchFilter, setBranchFilter] = useState('')
    const [searchInput, setSearchInput] = useState('')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(0)

    // Hasil. `key` menandai filter mana yang menghasilkan data ini, sehingga status memuat
    // cukup dibandingkan dengan filter yang sedang aktif.
    const [result, setResult] = useState({ key: null, rows: [], total: 0, error: null })
    const [reloadToken, setReloadToken] = useState(0)

    // Modal WhatsApp
    const [waRow, setWaRow] = useState(null)
    const [waTemplate, setWaTemplate] = useState('recall')
    const [waMessage, setWaMessage] = useState('')
    const [waOutcome, setWaOutcome] = useState('no_response')
    const [waNotes, setWaNotes] = useState('')
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        let active = true
        supabase
            .from('treatments')
            .select('id, name, is_active, followup_days, treatment_categories(name)')
            .order('name', { ascending: true })
            .then(({ data, error }) => {
                if (!active) return
                if (error) {
                    toast.error('Gagal memuat daftar treatment: ' + getFriendlyErrorMessage(error))
                    return
                }
                setTreatments((data || []).filter(t => !PACKAGE_NAME_RE.test(t.name || '')))
            })
        return () => { active = false }
    }, [])

    useEffect(() => {
        const handle = setTimeout(() => {
            setSearch(searchInput.trim())
            setPage(0)
        }, 400)
        return () => clearTimeout(handle)
    }, [searchInput])

    useEffect(() => {
        const onClick = (e) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [])

    const effectiveBranch = isOwner ? branchFilter : (userBranchId || '')

    const rpcParams = useMemo(() => {
        if (selectedIds.length === 0) return null
        const params = {
            p_treatment_ids: selectedIds,
            p_branch_id: effectiveBranch || null,
            p_search: search || null,
            p_limit: PAGE_SIZE,
            p_offset: page * PAGE_SIZE
        }
        const def = STAGES.find(s => s.id === stage)
        if (stage === 'due') {
            params.p_due_by_followup = true
        } else if (stage === 'custom') {
            // Tanggal kustom diubah menjadi umur treatment terakhir dalam hari.
            const today = toLocalYYYYMMDD()
            if (customEnd) params.p_min_days = Math.max(0, daysBetween(customEnd, today))
            if (customStart) params.p_max_days = Math.max(0, daysBetween(customStart, today))
        } else if (def) {
            if (def.min !== undefined) params.p_min_days = def.min
            if (def.max !== undefined) params.p_max_days = def.max
        }
        return params
    }, [selectedIds, effectiveBranch, search, page, stage, customStart, customEnd])

    const requestKey = rpcParams ? JSON.stringify([rpcParams, reloadToken]) : null

    useEffect(() => {
        if (!rpcParams) return
        let active = true
        supabase.rpc('crm_treatment_targets', rpcParams).then(({ data, error }) => {
            if (!active) return
            if (error) {
                setResult({ key: requestKey, rows: [], total: 0, error })
                return
            }
            setResult({
                key: requestKey,
                rows: data || [],
                total: data && data.length > 0 ? Number(data[0].total_count) : 0,
                error: null
            })
        })
        return () => { active = false }
    }, [requestKey])

    const isLoading = rpcParams !== null && result.key !== requestKey
    const rows = rpcParams && !isLoading ? result.rows : []
    const total = rpcParams && !isLoading ? result.total : 0
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

    const groupedTreatments = useMemo(() => {
        const q = pickerSearch.trim().toLowerCase()
        const groups = new Map()
        treatments
            .filter(t => showInactive || t.is_active)
            .filter(t => !q || t.name.toLowerCase().includes(q))
            .forEach(t => {
                const cat = t.treatment_categories?.name || 'Tanpa Kategori'
                if (!groups.has(cat)) groups.set(cat, [])
                groups.get(cat).push(t)
            })
        return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    }, [treatments, showInactive, pickerSearch])

    const selectedTreatments = useMemo(
        () => treatments.filter(t => selectedIds.includes(t.id)),
        [treatments, selectedIds]
    )

    const toggleTreatment = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
        setPage(0)
    }

    const openWaModal = (row) => {
        const key = templateForRow(stage, row.days_since)
        setWaRow(row)
        setWaTemplate(key)
        setWaMessage(fillTemplate(key, row))
        setWaOutcome('no_response')
        setWaNotes('')
    }

    const changeTemplate = (key) => {
        setWaTemplate(key)
        setWaMessage(fillTemplate(key, waRow))
    }

    const sendWaAndSaveLog = async () => {
        if (!waRow || isSaving) return
        // WhatsApp dibuka lebih dulu, langsung dari klik, agar tidak diblokir browser.
        openWhatsApp(waRow.whatsapp, waMessage)
        setIsSaving(true)
        const performedAt = new Date().toISOString()
        const { error } = await supabase.from('followup_logs').insert([{
            patient_id: waRow.patient_id,
            branch_id: waRow.branch_id,
            performed_by: user?.id || null,
            followup_type: 'treatment_specific',
            treatment_id: waRow.last_treatment_id,
            channel: 'whatsapp',
            outcome: waOutcome,
            notes: waNotes ? `[${waTemplate}] ${waNotes}` : `[${waTemplate}]`,
            performed_at: performedAt
        }])
        setIsSaving(false)
        if (error) {
            toast.error('WhatsApp dibuka, tetapi log gagal disimpan: ' + getFriendlyErrorMessage(error))
            return
        }
        toast.success(`Log follow-up ${waRow.full_name} tersimpan`)
        setWaRow(null)
        setReloadToken(t => t + 1)
    }

    const stageMeta = STAGES.find(s => s.id === stage)

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-base font-extrabold text-gray-900">Target Treatment</h3>
                <p className="text-xs text-gray-500 mt-0.5">Pasien yang pernah mengambil treatment tertentu, untuk aftercare, pengingat perawatan ulang, dan penawaran kembali.</p>
            </div>

            {/* Filter */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="relative xl:col-span-2" ref={pickerRef}>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Treatment</label>
                    <button
                        type="button"
                        onClick={() => setPickerOpen(o => !o)}
                        className="input-ayumi w-full text-left text-sm rounded-xl flex items-center justify-between gap-2"
                    >
                        <span className={`truncate ${selectedTreatments.length ? 'text-gray-800 font-semibold' : 'text-gray-400'}`}>
                            {selectedTreatments.length === 0
                                ? 'Pilih satu atau beberapa treatment...'
                                : selectedTreatments.map(t => t.name).join(', ')}
                        </span>
                        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {pickerOpen && (
                        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-2xl shadow-xl p-2">
                            <input
                                type="text"
                                autoFocus
                                value={pickerSearch}
                                onChange={(e) => setPickerSearch(e.target.value)}
                                placeholder="Cari treatment..."
                                className="input-ayumi text-sm rounded-xl py-2 mb-2"
                            />
                            <div className="max-h-72 overflow-y-auto">
                                {groupedTreatments.length === 0 && (
                                    <p className="text-xs text-gray-400 p-3 text-center">Treatment tidak ditemukan.</p>
                                )}
                                {groupedTreatments.map(([cat, list]) => (
                                    <div key={cat} className="mb-1">
                                        <p className="px-2 pt-2 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{cat}</p>
                                        {list.map(t => (
                                            <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-pink-50/60 cursor-pointer text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.includes(t.id)}
                                                    onChange={() => toggleTreatment(t.id)}
                                                    className="accent-ayumi-primary"
                                                />
                                                <span className="flex-1 text-gray-700">{t.name}</span>
                                                {!t.is_active && <span className="text-[10px] text-gray-400">nonaktif</span>}
                                            </label>
                                        ))}
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center justify-between gap-2 border-t border-gray-100 mt-2 pt-2 px-1">
                                <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                                    <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                                    Tampilkan treatment nonaktif (nama lama GD)
                                </label>
                                {selectedIds.length > 0 && (
                                    <button type="button" onClick={() => { setSelectedIds([]); setPage(0) }} className="text-[11px] font-bold text-rose-500 hover:text-rose-600">
                                        Kosongkan
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Waktu Follow Up</label>
                    <select
                        value={stage}
                        onChange={(e) => { setStage(e.target.value); setPage(0) }}
                        className="input-ayumi text-sm rounded-xl font-medium"
                    >
                        {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                </div>

                <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Cabang Treatment</label>
                    <select
                        value={effectiveBranch}
                        onChange={(e) => { setBranchFilter(e.target.value); setPage(0) }}
                        disabled={!isOwner}
                        className="input-ayumi text-sm rounded-xl font-medium disabled:opacity-70"
                    >
                        {isOwner && <option value="">Semua Cabang</option>}
                        {branches
                            .filter(b => isOwner || b.id === userBranchId)
                            .map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                </div>

                {stage === 'custom' && (
                    <div className="md:col-span-2 grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Treatment terakhir dari</label>
                            <input type="date" value={customStart} max={customEnd || undefined} onChange={(e) => { setCustomStart(e.target.value); setPage(0) }} className="input-ayumi text-sm rounded-xl" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">sampai</label>
                            <input type="date" value={customEnd} min={customStart || undefined} onChange={(e) => { setCustomEnd(e.target.value); setPage(0) }} className="input-ayumi text-sm rounded-xl" />
                        </div>
                    </div>
                )}

                <div className={stage === 'custom' ? 'md:col-span-2' : 'md:col-span-2 xl:col-span-4'}>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Cari Pasien</label>
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Nama pasien atau nomor WhatsApp..."
                        className="input-ayumi text-sm rounded-xl"
                    />
                </div>
            </div>

            {/* Hasil */}
            {selectedIds.length === 0 ? (
                <div className="text-center py-14 bg-gray-50/70 rounded-3xl border border-dashed border-gray-200">
                    <p className="text-gray-700 font-extrabold text-sm">Pilih treatment terlebih dahulu</p>
                    <p className="text-gray-400 text-xs mt-1">Daftar pasien muncul setelah minimal satu treatment dipilih.</p>
                </div>
            ) : isLoading ? (
                <div className="text-center py-14">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ayumi-primary mx-auto mb-3"></div>
                    <p className="text-gray-500 text-sm font-medium">Memuat pasien...</p>
                </div>
            ) : result.error ? (
                <div className="text-center py-10 bg-rose-50 rounded-3xl border border-rose-200 text-sm text-rose-700 font-semibold">
                    Gagal memuat daftar: {getFriendlyErrorMessage(result.error)}
                </div>
            ) : rows.length === 0 ? (
                <div className="text-center py-14 bg-gray-50/70 rounded-3xl border border-dashed border-gray-200">
                    <p className="text-gray-700 font-extrabold text-sm">Tidak ada pasien</p>
                    <p className="text-gray-400 text-xs mt-1">Tidak ada pasien yang cocok untuk filter &ldquo;{stageMeta?.label}&rdquo;.</p>
                </div>
            ) : (
                <>
                    <p className="text-xs text-gray-500">
                        <span className="font-bold text-gray-700">{total}</span> pasien • halaman {page + 1} dari {pageCount}
                    </p>
                    <div className="overflow-x-auto border border-gray-100 rounded-2xl">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="bg-ayumi-table-header text-ayumi-secondary text-xs uppercase tracking-wider">
                                    <th className="px-4 py-3 font-semibold">Pasien</th>
                                    <th className="px-4 py-3 font-semibold">Treatment</th>
                                    <th className="px-4 py-3 font-semibold">Terakhir</th>
                                    <th className="px-4 py-3 font-semibold">Follow Up</th>
                                    <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {rows.map(row => {
                                    const visitedLater = row.last_visit_date && row.last_visit_date > row.last_treatment_date
                                    return (
                                        <tr key={row.patient_id} className="align-top hover:bg-ayumi-table-hover">
                                            <td className="px-4 py-3">
                                                <Link href={`/patients/${row.patient_id}`} className="font-bold text-gray-800 hover:text-ayumi-primary">
                                                    {row.full_name}
                                                </Link>
                                                <div className="text-xs text-gray-500">{row.whatsapp || '-'}</div>
                                                {row.in_queue && (
                                                    <span className="inline-block mt-1 px-2 py-0.5 rounded-md text-[10.5px] font-bold bg-orange-50 text-orange-700 border border-orange-200">
                                                        📌 Terjadwal di Antrean CRM
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-semibold text-ayumi-primary">{row.last_treatment_name}</div>
                                                <div className="text-xs text-gray-500">{row.times_taken}× • {row.branch_name || '-'}</div>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <div className="text-gray-800">{formatDay(row.last_treatment_date)}</div>
                                                <div className="text-xs text-gray-500">{daysAgoLabel(row.days_since)}</div>
                                                {visitedLater && (
                                                    <div className="text-[11px] text-sky-700 mt-0.5">Kunjungan klinik terakhir: {daysAgoLabel(row.last_visit_days)}</div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-xs">
                                                {row.last_treatment_contact_at ? (
                                                    <span className="text-emerald-700 font-semibold">Dihubungi soal treatment ini: {formatDay(row.last_treatment_contact_at)}</span>
                                                ) : row.last_contact_at ? (
                                                    <span className="text-gray-600">
                                                        Terakhir dihubungi: {formatDay(row.last_contact_at)}
                                                        {row.last_contact_outcome && <span className="text-gray-400"> ({OUTCOME_LABEL[row.last_contact_outcome] || row.last_contact_outcome})</span>}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 italic">Belum pernah di-follow up</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => openWaModal(row)}
                                                    disabled={!row.whatsapp}
                                                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-xl text-xs font-extrabold shadow-sm cursor-pointer whitespace-nowrap"
                                                >
                                                    Kirim WA
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                    {pageCount > 1 && (
                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                disabled={page === 0}
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 disabled:opacity-40"
                            >
                                Sebelumnya
                            </button>
                            <button
                                type="button"
                                disabled={page + 1 >= pageCount}
                                onClick={() => setPage(p => p + 1)}
                                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 disabled:opacity-40"
                            >
                                Berikutnya
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* Modal WhatsApp & log */}
            {waRow && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-gray-100 my-8">
                        <h3 className="text-lg font-extrabold text-gray-900 leading-tight">Kirim WhatsApp & Simpan Log</h3>
                        <p className="text-xs text-gray-500 mt-1">
                            {waRow.full_name} (+{waRow.whatsapp}) • {waRow.last_treatment_name}, {daysAgoLabel(waRow.days_since)}
                        </p>

                        <div className="space-y-4 mt-5">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Template Pesan</label>
                                <select value={waTemplate} onChange={(e) => changeTemplate(e.target.value)} className="input-ayumi rounded-xl text-sm font-semibold">
                                    {Object.entries(TEMPLATES).map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Pratinjau & Edit Pesan</label>
                                <textarea
                                    value={waMessage}
                                    onChange={(e) => setWaMessage(e.target.value)}
                                    rows="7"
                                    className="input-ayumi resize-none text-sm leading-relaxed rounded-xl"
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Hasil Kontak</label>
                                    <select value={waOutcome} onChange={(e) => setWaOutcome(e.target.value)} className="input-ayumi rounded-xl text-sm">
                                        {OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Catatan (Opsional)</label>
                                    <input type="text" value={waNotes} onChange={(e) => setWaNotes(e.target.value)} className="input-ayumi text-sm rounded-xl" placeholder="mis. minta jadwal Sabtu" />
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 mt-7 border-t border-gray-100 pt-5">
                            <button
                                type="button"
                                onClick={() => setWaRow(null)}
                                className="w-full sm:w-auto px-5 py-2.5 rounded-2xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 text-sm cursor-pointer"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={sendWaAndSaveLog}
                                disabled={isSaving || !waMessage.trim()}
                                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-2xl font-extrabold text-sm shadow-md shadow-emerald-600/20 cursor-pointer"
                            >
                                {isSaving ? 'Menyimpan...' : 'Buka WhatsApp & Simpan Log'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
