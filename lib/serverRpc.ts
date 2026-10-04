// Server-only: imported exclusively by server-side helpers of the
// app/api/**/+api.ts route handlers (lib/anonymousTrial.ts,
// lib/aiUsageLimit.ts, lib/serverPlan.ts, lib/serverAccount.ts).
//
// Runs a Postgres function in Supabase as the service role, or reads one of
// the server-only tables. The functions it calls are granted to service_role
// alone and those tables have no policies (supabase/schema.sql), so the app's
// publishable key can't touch them, and SUPABASE_SECRET_KEY (no EXPO_PUBLIC_
// prefix) never reaches the app bundle.

/** SUPABASE_SECRET_KEY (or the URL) isn't set, so the function can't be called. */
export class RpcConfigError extends Error {}

function serviceRoleRequest(): { url: string; headers: Record<string, string> } {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new RpcConfigError();

  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: secretKey };
  // A legacy service_role key is a JWT and goes in Authorization as well; the
  // newer sb_secret_ keys are only accepted in the apikey header.
  if (secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${secretKey}`;
  return { url, headers };
}

export async function callServerRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { url, headers } = serviceRoleRequest();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

/**
 * Reads rows of a table as the service role, which the tables' row-level
 * security doesn't apply to. `filters` are PostgREST's own ("eq.value").
 */
export async function selectServerRows<T>(table: string, columns: string, filters: Record<string, string>): Promise<T[]> {
  const { url, headers } = serviceRoleRequest();
  const query = new URLSearchParams({ select: columns, ...filters });
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
  if (!response.ok) throw new Error(`reading ${table} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T[];
}

/** Deletes every row of a table that matches `filters` (PostgREST's own, "eq.value"), as the service role. */
export async function deleteServerRows(table: string, filters: Record<string, string>): Promise<void> {
  if (Object.keys(filters).length === 0) throw new Error(`refusing to delete every row of ${table}`);
  const { url, headers } = serviceRoleRequest();
  const query = new URLSearchParams(filters);
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, { method: "DELETE", headers });
  if (!response.ok) throw new Error(`deleting from ${table} failed: ${response.status} ${await response.text()}`);
}

const STORAGE_PAGE_SIZE = 100;

/**
 * Empties "<folder>/" in a storage bucket, as the service role. Files go a
 * page at a time; a bucket that doesn't exist simply has nothing in it.
 */
export async function emptyServerFolder(bucket: string, folder: string): Promise<void> {
  if (!folder || folder.includes("/")) throw new Error(`refusing to empty "${folder}" in ${bucket}`);
  const { url, headers } = serviceRoleRequest();
  for (;;) {
    const listed = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prefix: folder, limit: STORAGE_PAGE_SIZE, offset: 0 }),
    });
    if (!listed.ok) throw new Error(`listing ${bucket}/${folder} failed: ${listed.status} ${await listed.text()}`);
    const files = ((await listed.json()) as { name: string }[]).map((file) => `${folder}/${file.name}`);
    if (files.length === 0) return;

    const removed = await fetch(`${url}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ prefixes: files }),
    });
    if (!removed.ok) throw new Error(`emptying ${bucket}/${folder} failed: ${removed.status} ${await removed.text()}`);
    if (((await removed.json()) as unknown[]).length === 0) throw new Error(`emptying ${bucket}/${folder} made no progress`);
    if (files.length < STORAGE_PAGE_SIZE) return;
  }
}
