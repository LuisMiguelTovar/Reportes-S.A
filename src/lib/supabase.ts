import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Creamos una única instancia del cliente para usarla en toda la app web
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const isInvalidRefreshTokenError = (error: unknown): boolean => {
  if (!error) return false;
  const msg = (
    (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '') || String(error)
  ).toLowerCase();
  return (
    msg.includes('invalid refresh token') ||
    msg.includes('refresh token not found') ||
    msg.includes('refresh_token_not_found')
  );
};

const originalSignOut = supabase.auth.signOut.bind(supabase.auth);
const originalGetUser = supabase.auth.getUser.bind(supabase.auth);
const originalGetSession = supabase.auth.getSession.bind(supabase.auth);

export const handleInvalidRefreshToken = async (): Promise<void> => {
  try {
    await originalSignOut();
  } catch {
    /* ignorar error de cierre */
  }
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.replace('/login');
  }
};

// Proxy interceptor de getUser: silencia 'Invalid Refresh Token', cierra sesión y redirige a /login
supabase.auth.getUser = (async (jwt?: string) => {
  try {
    const res = await originalGetUser(jwt);
    if (res.error && isInvalidRefreshTokenError(res.error)) {
      await handleInvalidRefreshToken();
      return { data: { user: null }, error: null } as unknown as typeof res;
    }
    return res;
  } catch (err) {
    if (isInvalidRefreshTokenError(err)) {
      await handleInvalidRefreshToken();
      return { data: { user: null }, error: null } as unknown as Awaited<ReturnType<typeof originalGetUser>>;
    }
    throw err;
  }
}) as typeof supabase.auth.getUser;

// Proxy interceptor de getSession: silencia 'Invalid Refresh Token', cierra sesión y redirige a /login
supabase.auth.getSession = (async () => {
  try {
    const res = await originalGetSession();
    if (res.error && isInvalidRefreshTokenError(res.error)) {
      await handleInvalidRefreshToken();
      return { data: { session: null }, error: null } as unknown as typeof res;
    }
    return res;
  } catch (err) {
    if (isInvalidRefreshTokenError(err)) {
      await handleInvalidRefreshToken();
      return { data: { session: null }, error: null } as unknown as Awaited<ReturnType<typeof originalGetSession>>;
    }
    throw err;
  }
}) as typeof supabase.auth.getSession;
