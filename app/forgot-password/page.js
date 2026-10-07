'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')

    try {
      const redirectTo = `${window.location.origin}/reset-password`
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
      if (resetError) throw resetError
      setMessage('If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.')
    } catch (err) {
      setError(err?.message || 'Could not send the password reset email.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen px-5 py-8 sm:grid sm:place-items-center" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto w-full max-w-[420px]">
        <div className="mb-7 text-center">
          <div className="app-brand-mark mx-auto mb-4">MGT</div>
          <h1 className="text-2xl font-black tracking-tight">Recover your account</h1>
          <p className="mt-2 text-sm text-muted">Enter your sign-in email and MGT will send you a secure reset link.</p>
        </div>

        <form onSubmit={submit} className="page-card p-5 sm:p-6">
          {message && <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm">{message}</div>}
          {error && <div className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}

          <label htmlFor="recovery-email" className="mb-2 block text-sm font-bold">Email address</label>
          <input
            id="recovery-email"
            type="email"
            autoComplete="email"
            required
            className="input-base"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <button disabled={loading} className="btn-primary mt-5 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">
            {loading ? 'Sending reset link...' : 'Send reset link'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          Remembered your password? <Link href="/login" className="font-bold text-accent">Back to sign in</Link>
        </p>
      </div>
    </main>
  )
}
