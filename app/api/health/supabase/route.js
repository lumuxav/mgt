import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const EXPECTED_MGT_SUPABASE_REF = 'mehuiivevjqmwvaapbgz'
const isExpectedMgtUrl = (url) => { try { return new URL(url).hostname === `${EXPECTED_MGT_SUPABASE_REF}.supabase.co` } catch { return false } }

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req) {
  const expectedSecret = process.env.HEALTHCHECK_SECRET
  const auth = req.headers.get('authorization') || ''

  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: 'Health check is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: 'Supabase server environment is incomplete.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  if (!isExpectedMgtUrl(url)) {
    return NextResponse.json({ ok: false, error: 'MGT database isolation guard blocked a non-MGT Supabase project.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error } = await supabase.from('users').select('id').limit(1)

  if (error) {
    return NextResponse.json(
      { ok: false, database: 'unavailable', error: error.message },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  return NextResponse.json(
    {
      ok: true,
      database: 'reachable',
      service: 'mgt-business-suite',
      checked_at: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
