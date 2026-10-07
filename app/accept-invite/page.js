'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function AcceptInvitePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const resolveSession = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return false

    const { data: userProfile } = await supabase
      .from('users')
      .select('id, full_name, email, role, active, organization_id')
      .eq('id', session.user.id)
      .maybeSingle()

    if (userProfile?.active === false) {
      await supabase.auth.signOut()
      setError('This invitation is no longer active. Contact the business administrator.')
      return false
    }

    setProfile(userProfile)
    setReady(true)
    return true
  }

  useEffect(() => {
    let mounted = true
    resolveSession()

    const { data: listener } = supabase.auth.onAuthStateChange(async (event) => {
      if (!mounted) return
      if (['SIGNED_IN', 'INITIAL_SESSION', 'PASSWORD_RECOVERY'].includes(event)) {
        await resolveSession()
      }
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    setError('')

    if (password.length < 8) return setError('Use a password with at least 8 characters.')
    if (password !== confirmPassword) return setError('Passwords do not match.')

    setLoading(true)
    try {
      const { error: passwordError } = await supabase.auth.updateUser({ password })
      if (passwordError) throw passwordError

      await supabase.rpc('accept_my_staff_invitation')
      router.replace('/')
    } catch (err) {
      setError(err?.message || 'Could not finish account setup.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen px-5 py-8 sm:grid sm:place-items-center" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto w-full max-w-[430px]">
        <div className="mb-7 text-center">
          <div className="app-brand-mark mx-auto mb-4">MGT</div>
          <h1 className="text-2xl font-black">Join your business workspace</h1>
          <p className="mt-2 text-sm text-muted">{profile?.full_name ? `Welcome ${profile.full_name}. Choose your private password to finish setup.` : 'Open the invitation link from your email to continue.'}</p>
        </div>

        <form onSubmit={submit} className="page-card p-5 sm:p-6">
          {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}

          {!ready ? (
            <div className="rounded-xl bg-[var(--panel-2)] p-4 text-sm text-muted">
              Waiting for a valid MGT invitation session. If this invitation has expired, ask the business administrator to invite you again.
            </div>
          ) : (
            <>
              <div className="mb-5 rounded-xl bg-[var(--panel-2)] p-3 text-sm">
                <strong>{profile?.full_name}</strong>
                <p className="mt-1 text-xs text-muted">{profile?.email || 'Invited staff account'} · {String(profile?.role || 'employee').replaceAll('_', ' ')}</p>
              </div>

              <label htmlFor="invite-password" className="mb-2 block text-sm font-bold">Create password</label>
              <div className="relative">
                <input id="invite-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required className="input-base pr-16" value={password} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-2 my-auto h-fit rounded-lg px-2 py-1 text-xs font-bold text-muted">{showPassword ? 'Hide' : 'Show'}</button>
              </div>

              <label htmlFor="invite-confirm" className="mb-2 mt-4 block text-sm font-bold">Confirm password</label>
              <input id="invite-confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required className="input-base" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />

              <button disabled={loading} className="btn-primary mt-5 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{loading ? 'Finishing setup...' : 'Join workspace'}</button>
            </>
          )}
        </form>
      </div>
    </main>
  )
}
