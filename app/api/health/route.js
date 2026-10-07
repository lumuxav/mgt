import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'mgt-business-suite',
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || 'local',
    checked_at: new Date().toISOString(),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
