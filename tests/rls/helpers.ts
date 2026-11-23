import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

// Las claves de pruebas viven en un archivo local de entorno de test (gitignoreado).
config({ path: ".env.test.local", quiet: true });

const url = process.env.TEST_SUPABASE_URL;
const anon = process.env.TEST_SUPABASE_ANON_KEY;
const service = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

export const rlsConfigured = Boolean(url && anon && service);

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const admin = () => createClient(url!, service!, opts);

/** Crea un usuario ficticio ya confirmado y devuelve un cliente con su sesión. */
export async function createUser(name: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `${name.toLowerCase()}.${crypto.randomUUID().slice(0, 8)}@example.test`;
  const password = `Pw-${crypto.randomUUID()}-Ok1`;
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error || !data.user) throw error ?? new Error("no se pudo crear el usuario");
  const client = createClient(url!, anon!, opts);
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw signErr;
  return { id: data.user.id, client };
}

export const anonClient = () => createClient(url!, anon!, opts);
