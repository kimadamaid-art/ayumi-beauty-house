'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'

export default function LeadsPage() {
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [leads, setLeads] = useState([])
    const [loading, setLoading] = useState(true)
    const [filterStatus, setFilterStatus] = useState('all')
    const [filterSource, setFilterSource] = useState('all')

    const STATUSES = ['new', 'contacted', 'interested', 'booked', 'converted', 'lost']
    const SOURCES = ['instagram', 'tiktok', 'facebook', 'google', 'referral', 'walk_in', 'whatsapp', 'other']

    useEffect(() => {
        fetchLeads()
    }, [])

    const fetchLeads = async () => {
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
            .from('leads')
            .select('*')
            .order('created_at', { ascending: false })
            
        if (!isOwner && userBranchId) {
            query = query.eq('branch_id', userBranchId)
        }

        const { data, error } = await query

        if (data) setLeads(data)
        setLoading(false)
    }

    const filteredLeads = leads.filter(l => {
        if (filterStatus !== 'all' && l.status !== filterStatus) return false
        if (filterSource !== 'all' && l.source !== filterSource) return false
        return true
    })

    const getStatusColor = (status) => {
        switch (status) {
            case 'new': return 'bg-blue-100 text-blue-700'
            case 'contacted': return 'bg-yellow-100 text-yellow-700'
            case 'interested': return 'bg-orange-100 text-orange-700'
            case 'booked': return 'bg-purple-100 text-purple-700'
            case 'converted': return 'bg-green-100 text-green-700'
            case 'lost': return 'bg-red-100 text-red-700'
            default: return 'bg-gray-100 text-gray-700'
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex gap-3">
                    <select 
                        value={filterStatus} 
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="input-ayumi bg-white w-auto"
                    >
                        <option value="all">Semua Status</option>
                        {STATUSES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                    </select>

                    <select 
                        value={filterSource} 
                        onChange={(e) => setFilterSource(e.target.value)}
                        className="input-ayumi bg-white w-auto"
                    >
                        <option value="all">Semua Sumber</option>
                        {SOURCES.map(s => <option key={s} value={s}>{s.replace('_', ' ').toUpperCase()}</option>)}
                    </select>
                </div>

                <Link href="/leads/new">
                    <button className="btn-primary py-2.5 flex items-center gap-2">
                        <span>+ Tambah Lead</span>
                    </button>
                </Link>
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
                                    <th className="px-6 py-4">Tanggal Masuk</th>
                                    <th className="px-6 py-4">Calon Pasien</th>
                                    <th className="px-6 py-4">Sumber</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredLeads.length > 0 ? (
                                    filteredLeads.map((lead) => (
                                        <tr key={lead.id} className="bg-white border-b border-gray-50 hover:bg-ayumi-table-hover transition-colors">
                                            <td className="px-6 py-4 font-semibold text-gray-700">
                                                {new Date(lead.created_at).toLocaleDateString('id-ID', {day: 'numeric', month: 'short', year: 'numeric'})}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-800">{lead.full_name}</div>
                                                <div className="text-xs text-gray-500">{lead.whatsapp}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="font-bold text-gray-600 uppercase text-xs">
                                                    {lead.source?.replace('_', ' ')}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${getStatusColor(lead.status)}`}>
                                                    {lead.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <Link href={`/leads/${lead.id}`}>
                                                    <button className="text-xs bg-white border border-ayumi-primary text-ayumi-primary hover:bg-pink-50 px-4 py-2 rounded-lg font-bold transition-colors">
                                                        Detail
                                                    </button>
                                                </Link>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-12 text-center flex flex-col items-center border-none">
                                            <div className="w-16 h-16 bg-pink-50 rounded-full flex items-center justify-center mb-4 mx-auto">
                                                <svg className="w-8 h-8 text-pink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                                            </div>
                                            <p className="text-gray-500 font-medium text-lg">Belum ada data leads.</p>
                                            <p className="text-sm text-gray-400 mt-1">Coba sesuaikan filter atau tambahkan lead baru.</p>
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
