'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'

export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const router = useRouter()
    
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const handleLogin = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password
        })
        
        if (error) {
            setError('Email atau password salah.')
            setLoading(false)
        } else {
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
                if (userData?.role === 'therapist') {
                    router.push('/therapist/dashboard')
                } else {
                    router.push('/dashboard')
                }
            } else {
                router.push('/dashboard')
            }
            router.refresh()
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ayumi-accent to-ayumi-secondary">
            <div className="card-ayumi p-10 shadow-2xl w-full max-w-md border border-white/40 backdrop-blur-sm relative overflow-hidden">
                {/* Decorative blob */}
                <div className="absolute -top-20 -right-20 w-40 h-40 bg-ayumi-accent rounded-full opacity-20 blur-2xl"></div>
                <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-ayumi-primary rounded-full opacity-20 blur-2xl"></div>
                
                <div className="text-center mb-8 relative z-10">
                    <div className="mx-auto w-16 h-16 bg-gradient-to-tr from-ayumi-secondary to-ayumi-primary rounded-full flex items-center justify-center mb-4 shadow-lg text-white">
                        <span className="font-extrabold text-2xl font-sans tracking-tighter">ab</span>
                    </div>
                    <h1 className="text-3xl font-extrabold text-ayumi-text mb-2 tracking-tight">
                        Ayumi Beauty House
                    </h1>
                    <p className="text-ayumi-text-muted text-sm font-medium tracking-wide">Kecantikan, Kosmetik & Perawatan Diri</p>
                </div>

                {error && (
                    <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm mb-6 border border-red-100 text-center font-medium animate-pulse">
                        {error}
                    </div>
                )}

                <form onSubmit={handleLogin} className="space-y-5 relative z-10">
                    <div>
                        <label className="block text-sm font-bold text-ayumi-text mb-2 ml-1">Email</label>
                        <input
                            type="email"
                            placeholder="nama@email.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            className="input-ayumi bg-gray-50 focus:bg-white"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-ayumi-text mb-2 ml-1">Password</label>
                        <input
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            className="input-ayumi bg-gray-50 focus:bg-white"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full btn-primary py-4 mt-4 text-base"
                    >
                        {loading ? 'Memproses...' : 'Masuk'}
                    </button>
                </form>
            </div>
        </div>
    )
}
