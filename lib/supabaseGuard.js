export const EXPECTED_MGT_SUPABASE_REF = 'mehuiivevjqmwvaapbgz'

export function assertMgtSupabaseUrl(url) {
  if (!url) throw new Error('MGT Supabase URL is not configured.')
  let host = ''
  try { host = new URL(url).hostname } catch { throw new Error('MGT Supabase URL is invalid.') }
  if (host !== `${EXPECTED_MGT_SUPABASE_REF}.supabase.co`) {
    throw new Error('MGT database isolation guard blocked a non-MGT Supabase project.')
  }
  return url
}
