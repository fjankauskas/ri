import { createClient } from "@supabase/supabase-js";
// Cliente con la clave de servicio (service_role / «secret key»): se salta RLS. SOLO se usa en el servidor, siempre después de
// verificar el rol del usuario y filtrando por la empresa de su sesión. Nunca lleva el prefijo NEXT_PUBLIC_.
export const hasServiceKey = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY;
export function createAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local (la clave «service_role» o «secret» de Supabase; solo la usa el servidor).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
