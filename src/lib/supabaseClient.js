import { createClient } from '@supabase/supabase-js'

const resolveEnv = (...keys) => {
  for (const key of keys) {
    const value = import.meta.env[key]
    if (value) return value
  }
  return ''
}

const supabaseUrl = resolveEnv(
  'VITE_SUPABASE_URL',
  'PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_DATABASE_URL',
)

const supabaseAnonKey = resolveEnv(
  'VITE_SUPABASE_ANON_KEY',
  'PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
)

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan las variables de Supabase. Define VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY o utiliza variables PUBLIC_/SUPABASE_ equivalentes.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
