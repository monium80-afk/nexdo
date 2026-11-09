import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("Add EXPO_PUBLIC_SUPABASE_URL to your .env file");
}
if (!supabaseAnonKey) {
  throw new Error("Add EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env file");
}

// Supabase trusts Clerk's session JWT directly (Clerk is registered as a
// Third-Party Auth provider in the Supabase dashboard), so there is no
// separate Supabase Auth session — this callback is how the client attaches
// a fresh Clerk token to every request. Set once, from a component that has
// access to Clerk's useAuth().getToken (see app/(tabs)/_layout.tsx).
let getClerkToken: (() => Promise<string | null>) | null = null;

export function setClerkTokenGetter(fn: () => Promise<string | null>) {
  getClerkToken = fn;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: async () => (getClerkToken ? getClerkToken() : null),
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
