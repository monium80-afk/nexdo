// Server-only: imported exclusively by server-side helpers of the
// app/api/**/+api.ts route handlers (lib/anonymousTrial.ts,
// lib/aiUsageLimit.ts).
//
// Runs a Postgres function in Supabase as the service role. The functions it
// calls are granted to service_role alone (supabase/schema.sql), so the app's
// publishable key can't touch them, and SUPABASE_SECRET_KEY (no EXPO_PUBLIC_
// prefix) never reaches the app bundle.

/** SUPABASE_SECRET_KEY (or the URL) isn't set, so the function can't be called. */
export class RpcConfigError extends Error {}

export async function callServerRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new RpcConfigError();

  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: secretKey };
  // A legacy service_role key is a JWT and goes in Authorization as well; the
  // newer sb_secret_ keys are only accepted in the apikey header.
  if (secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${secretKey}`;

  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}
