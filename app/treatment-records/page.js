'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'

export default function TreatmentRecordsPage() {
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [records, setRecords] = useState([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')

    useEffect(() => {
        fetchRecords()
    }, [])

    const fetchRecords = async () => {
        setLoading(true)

        // Get current user's role and branch
        const { data: { user } } = await supabase.auth.getUser()
        let userBranchId = null
        let isOwner = false

        if (user) {
            const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
            if (userData) {
                isOwner = userData.role === 'owner'
                userBranchId = userData.branch_id
            } else {
                isOwner = true // fallback
            }
        }

        let query = supabase
            .from('treatment_records')
            .select(`
                id,
                treatment_date,
                treatment_time,
                branch_id,
                branches(name),
                patients(full_name, whatsapp),
                users!treatment_records_performed_by_fkey(full_name),
                therapist:users!treatment_records_therapist_id_fkey(full_name)
            `)
            .order('treatment_date', { ascending: false })
            .order('treatment_time', { ascending: false })
            
        if (!isOwner && userBranchId) {
            query = query.eq('branch_id', userBranchId)
        }

        const { data, error } = await query

        if (!error && data) {
            setRecords(data)
        }
        setLoading(false)
    }

    const filteredRecords = records.filter(r => 
        r.patients?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.patients?.whatsapp?.includes(searchTerm)
    )

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-end items-start sm:items-center gap-4">
                {/* Search Bar */}
                <div className="relative w-full sm:w-72">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    </div>
                    <input 
                        type="text" 
                        placeholder="Cari pasien atau WA..."
                        className="input-ayumi bg-white w-full pl-10"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center p-12">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
                </div>
            ) : (
                <div className="card-ayumi overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-600">
                            <thead className="text-xs text-ayumi-secondary uppercase bg-ayumi-table-header font-bold">
                                <tr>
                                    <th className="px-6 py-4">Waktu & Cabang</th>
                                    <th className="px-6 py-4">Pasien</th>
                                    <th className="px-6 py-4">Ditangani Oleh</th>
                                    <th className="px-6 py-4 text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRecords.length > 0 ? (
                                    filteredRecords.map((r) => (
                                        <tr key={r.id} className="bg-white border-b border-gray-50 hover:bg-ayumi-table-hover transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-800">
                                                    {new Date(r.treatment_date).toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}
                                                </div>
                                                <div className="text-xs text-gray-500 font-semibold mt-1">
                                                    {r.treatment_time?.substring(0,5) || '-'} • {r.branches?.name || 'Pusat'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-800">{r.patients?.full_name}</div>
                                                <div className="text-xs text-gray-500">{r.patients?.whatsapp}</div>
                                            </td>
                                            <td className="px-6 py-4 font-semibold text-gray-700">
                                                <div className="text-sm text-gray-800">Dr: {r.users?.full_name || '-'}</div>
                                                <div className="text-xs text-gray-500 mt-1">Terapis: {r.therapist?.full_name || '-'}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Link href={`/treatment-records/${r.id}`}>
                                                        <button className="text-xs bg-pink-50 text-ayumi-primary border border-transparent hover:border-ayumi-primary hover:bg-pink-100 px-3 py-2 rounded-lg font-bold transition-colors">
                                                            Lihat Detail
                                                        </button>
                                                    </Link>
                                                    {r.patients?.whatsapp && (() => {
                                                        let waNumber = r.patients.whatsapp.replace(/[^0-9]/g, '');
                                                        if (waNumber.startsWith('0')) {
                                                            waNumber = '62' + waNumber.substring(1);
                                                        }
                                                        return (
                                                            <a 
                                                                href={`https://wa.me/${waNumber}`} 
                                                                target="_blank" 
                                                                rel="noopener noreferrer" 
                                                                className="text-xs bg-green-50 text-green-700 border border-transparent hover:border-green-600 hover:bg-green-100 px-3 py-2 rounded-lg font-bold transition-colors"
                                                            >
                                                                Chat WA
                                                            </a>
                                                        );
                                                    })()}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="4" className="px-6 py-12 text-center flex flex-col items-center border-none">
                                            <div className="w-16 h-16 bg-pink-50 rounded-full flex items-center justify-center mb-4 mx-auto">
                                                <svg className="w-8 h-8 text-pink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                            </div>
                                            <p className="text-gray-500 font-medium text-lg">Tidak ada data rekam medis.</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}
