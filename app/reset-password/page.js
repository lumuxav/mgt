'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (mounted && session) setReady(true)
    }

    checkSession()

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    setMessage('')
    setError('')

    if (password.length < 8) {
      setError('Use a password with at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      setMessage('Password updated successfully. Redirecting you to sign in...')
      await supabase.auth.signOut()
      window.setTimeout(() => router.replace('/login'), 1200)
    } catch (err) {
      setError(err?.message || 'Could not update your password. Request a new reset link and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mgt-standalone-safe-page min-h-screen px-5 py-8 sm:grid sm:place-items-center" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto w-full max-w-[420px]">
        <div className="mb-7 text-center">
          <div className="app-brand-mark mx-auto mb-4">MGT</div>
          <h1 className="text-2xl font-black tracking-tight">Set a new password</h1>
          <p className="mt-2 text-sm text-muted">Choose a new password for your MGT account.</p>
        </div>

        <form onSubmit={submit} className="page-card p-5 sm:p-6">
          {message && <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm">{message}</div>}
          {error && <div className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}

          {!ready && !message ? (
            <div className="rounded-xl bg-[var(--panel-2)] p-4 text-sm text-muted">
              Waiting for a valid recovery session. If this link has expired, request a new reset link.
            </div>
          ) : (
            <>
              <label htmlFor="new-password" className="mb-2 block text-sm font-bold">New password</label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  className="input-base pr-16"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute inset-y-0 right-2 my-auto h-fit rounded-lg px-2 py-1 text-xs font-bold text-muted"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>

              <label htmlFor="confirm-password" className="mb-2 mt-4 block text-sm font-bold">Confirm new password</label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                className="input-base"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />

              <button disabled={loading} className="btn-primary mt-5 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">
                {loading ? 'Updating password...' : 'Update password'}
              </button>
            </>
          )}
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          Need a fresh link? <Link href="/forgot-password" className="font-bold text-accent">Request password reset</Link>
        </p>
      </div>
    </main>
  )
}
