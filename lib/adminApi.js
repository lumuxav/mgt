'use client'

import { supabase } from './supabase'

async function freshSession(forceRefresh = false) {
  let session = null

  if (!forceRefresh) {
    const { data } = await supabase.auth.getSession()
    session = data?.session || null
  }

  const expiresSoon = session?.expires_at
    ? session.expires_at <= Math.floor(Date.now() / 1000) + 90
    : true

  if (forceRefresh || !session || expiresSoon) {
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data?.session) return null
    session = data.session
  }

  return session
}

export async function adminApi(path, options = {}) {
  const run = async (session) => {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
        authorization: `Bearer ${session.access_token}`,
      },
    })

    let json = {}
    try {
      json = await response.json()
    } catch {
      json = { error: 'The server returned an unreadable response.' }
    }

    return { response, json }
  }

  let session = await freshSession(false)
  if (!session) {
    return { ok: false, status: 401, error: 'Session expired — sign in again.' }
  }

  let result = await run(session)

  if (result.response.status === 401) {
    session = await freshSession(true)
    if (!session) {
      return { ok: false, status: 401, error: 'Session expired — sign in again.' }
    }
    result = await run(session)
  }

  return {
    ok: result.response.ok,
    status: result.response.status,
    ...result.json,
  }
}
