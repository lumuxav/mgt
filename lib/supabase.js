import { createClient } from '@supabase/supabase-js'
import { assertMgtSupabaseUrl } from './supabaseGuard'

const url = assertMgtSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!key) throw new Error('MGT Supabase publishable key is not configured.')

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
