'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { setCachedProfile, clearSessionProfileCache } from '../../lib/sessionCache'
import { getBusinessConfig } from '../../lib/platformConfig'

export default function LoginPage() {
  const router = useRouter()
  const [business, setBusiness] = useState({ businessName: 'MGT Business Suite', shortName: 'MGT' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    let mounted = true

    const restore = async () => {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (!mounted) return
      setBusiness(getBusinessConfig())
      if (sessionError || !session) {
        setCheckingSession(false)
        return
      }

      const { data: prof, error: profileError } = await supabase
        .from('users')
        .select('full_name, role, active, archived_at, organization_id, default_location_id')
        .eq('id', session.user.id)
        .maybeSingle()

      if (!mounted) return
      if (profileError) {
        setError('Could not verify your business profile. Check your connection and try again.')
        setCheckingSession(false)
        return
      }

      if (!prof) {
        router.replace('/setup?bootstrap=1')
        return
      }

      if (prof.active === false || prof.archived_at) {
        clearSessionProfileCache()
        await supabase.auth.signOut()
        setCheckingSession(false)
        return
      }

      if (prof.organization_id) {
        const access = await supabase.rpc('current_user_role')
        if (!mounted) return
        if (access.error || !access.data) {
          setError(access.error ? 'Could not verify your access. Please try again.' : 'Your business or staff access is disabled. Contact management.')
          setCheckingSession(false)
          return
        }
      }

      setCachedProfile(session.user.id, prof)
      router.replace('/')
    }

    restore().catch(() => {
      if (mounted) {
        setError('Could not restore your session. Check your connection and try again.')
        setCheckingSession(false)
      }
    })
    return () => { mounted = false }
  }, [router])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) {
      setError('Wrong email or password.')
      setLoading(false)
      return
    }

    const { data: prof, error: profileError } = await supabase.from('users').select('full_name, role, active, archived_at, organization_id, default_location_id').eq('id', data.user.id).maybeSingle()
    if (profileError) {
      setError('Could not verify your business profile. Check your connection and try again.')
      setLoading(false)
      return
    }
    if (!prof) {
      router.replace('/setup?bootstrap=1')
      return
    }
    if (prof.active === false || prof.archived_at) {
      setError('This account has been deactivated — contact management.')
      clearSessionProfileCache()
      await supabase.auth.signOut()
      setLoading(false)
      return
    }

    if (prof.organization_id) {
      const access = await supabase.rpc('current_user_role')
      if (access.error || !access.data) {
        setError(access.error ? 'Could not verify your access. Please try again.' : 'Your business or staff access is disabled. Contact management.')
        setLoading(false)
        return
      }
    }

    setCachedProfile(data.user.id, prof)
    router.replace('/')
  }

  if (checkingSession) {
    return <main className="min-h-screen grid place-items-center px-5 py-8 text-muted" style={{ background: 'var(--bg)' }}>Opening {business.businessName || 'MGT Business Suite'}...</main>
  }

  return (
    <main className="min-h-screen grid place-items-center px-5 py-8" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-[390px]">
        <div className="mb-7 text-center">
          <div className="app-brand-mark mx-auto mb-4">{business.shortName || 'MGT'}</div>
          <h1 className="text-2xl font-black tracking-tight">{business.businessName || 'MGT Business Suite'}</h1>
          <p className="mt-1 text-sm text-muted">Business Management Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="page-card p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-lg font-black">Welcome back</h2>
            <p className="mt-1 text-sm text-muted">Sign in to continue.</p>
          </div>

          {error && <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-500" role="alert">{error}</div>}

          <label htmlFor="email" className="mb-2 block text-sm font-bold">Email address</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="input-base" placeholder="name@example.com" />

          <label htmlFor="password" className="mb-2 mt-4 block text-sm font-bold">Password</label>
          <div className="relative">
            <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="input-base pr-16" placeholder="Enter password" />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-2 my-auto h-fit rounded-lg px-2 py-1 text-xs font-bold text-muted">{showPassword ? 'Hide' : 'Show'}</button>
          </div>

          <div className="mt-3 text-right">
            <button type="button" onClick={() => router.push('/forgot-password')} className="text-xs font-bold text-accent">Forgot password?</button>
          </div>

          <button type="submit" disabled={loading} className="btn-primary mt-5 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{loading ? 'Signing in...' : 'Sign in'}</button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-3 text-xs text-muted">
          <span>New business?</span>
          <button type="button" onClick={() => router.push('/onboarding')} className="font-bold text-accent">Create owner account</button>
        </div>
        <p className="mt-4 text-center text-xs"><Link href="/install" className="font-bold text-accent">Install MGT on this device</Link></p>
      </div>
    </main>
  )
}
