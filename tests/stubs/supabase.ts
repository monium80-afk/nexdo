// A fake Supabase for store tests: keeps rows per table in memory, applies
// upserts and deletes the way PostgREST would (one call = one statement), and
// logs every write so a test can check exactly what reached the database.

type Row = Record<string, unknown> & { id: string };

/** Supabase's default cap on the rows one request returns. */
const MAX_ROWS = 1000;
type Filter = { column: string; values: unknown[] };
type Listener = { table: string; handler: (payload: unknown) => void };

export const fakeDb = {
  tables: new Map<string, Map<string, Row>>(),
  /** One entry per request: what it was and how many rows it carried. */
  writes: [] as { table: string; kind: "upsert" | "delete"; ids: string[] }[],
  /** Set to make the next write fail with this PostgREST error. */
  nextError: null as { code: string; message: string } | null,
  /** Columns the fake "database" doesn't have (PGRST204 when named). */
  missingColumns: new Set<string>(),
  /** While set, upserts wait for it before landing — a slow request (see holdUpserts). */
  upsertGate: null as Promise<void> | null,
  /** Realtime subscriptions still open. */
  listeners: [] as Listener[],
  reset() {
    this.tables.clear();
    this.writes = [];
    this.nextError = null;
    this.missingColumns.clear();
    this.upsertGate = null;
  },
  rows(table: string): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  },
  /** Every upsert from now on waits until the returned function is called. */
  holdUpserts(): () => void {
    let release: () => void = () => {};
    this.upsertGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.upsertGate = null;
      release();
    };
  },
  /** Delivers a realtime change, as if another device had made it. */
  emit(table: string, payload: unknown) {
    this.listeners.filter((listener) => listener.table === table).forEach((listener) => listener.handler(payload));
  },
};

function table(name: string): Map<string, Row> {
  if (!fakeDb.tables.has(name)) fakeDb.tables.set(name, new Map());
  return fakeDb.tables.get(name)!;
}

function takeError() {
  const error = fakeDb.nextError;
  fakeDb.nextError = null;
  return error;
}

function matches(row: Row, filters: Filter[]) {
  return filters.every((filter) => filter.values.includes(row[filter.column]));
}

function query(name: string) {
  const filters: Filter[] = [];
  let mode: "select" | "delete" = "select";
  let sort: { column: string; ascending: boolean } | null = null;
  // Rows a select may return, as PostgREST's .limit() / .range() do.
  let window: { from: number; to: number } | null = null;
  const builder = {
    select() {
      mode = "select";
      return builder;
    },
    delete() {
      mode = "delete";
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, values: [value] });
      return builder;
    },
    in(column: string, values: unknown[]) {
      filters.push({ column, values });
      return builder;
    },
    order(column: string, options?: { ascending?: boolean }) {
      sort = { column, ascending: options?.ascending ?? true };
      return builder;
    },
    limit(count: number) {
      window = { from: 0, to: count - 1 };
      return builder;
    },
    range(from: number, to: number) {
      window = { from, to };
      return builder;
    },
    upsert(input: Row | Row[]) {
      const rows = Array.isArray(input) ? input : [input];
      const land = () => {
        const missing = rows.flatMap((row) => Object.keys(row)).find((key) => fakeDb.missingColumns.has(key));
        if (missing) return { error: { code: "PGRST204", message: `Could not find the '${missing}' column` } };
        const error = takeError();
        if (error) return { error };
        rows.forEach((row) => table(name).set(row.id, { ...row }));
        fakeDb.writes.push({ table: name, kind: "upsert", ids: rows.map((row) => row.id) });
        return { error: null };
      };
      return fakeDb.upsertGate ? fakeDb.upsertGate.then(land) : Promise.resolve(land());
    },
    then(resolve: (value: { data?: Row[]; error: unknown }) => void) {
      if (mode === "delete") {
        const error = takeError();
        if (error) return resolve({ error });
        const doomed = [...table(name).values()].filter((row) => matches(row, filters));
        doomed.forEach((row) => table(name).delete(row.id));
        fakeDb.writes.push({ table: name, kind: "delete", ids: doomed.map((row) => row.id) });
        return resolve({ error: null });
      }
      let data = [...table(name).values()].filter((row) => matches(row, filters));
      if (sort) {
        const { column, ascending } = sort;
        data.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
      }
      // Like a real Supabase project, never more than 1,000 rows a request.
      const from = window?.from ?? 0;
      data = data.slice(from, Math.min(window ? window.to + 1 : Infinity, from + MAX_ROWS));
      return resolve({ data, error: null });
    },
  };
  return builder;
}

export const supabase = {
  from: (name: string) => query(name),
  channel: () => {
    const own: Listener[] = [];
    const channel = {
      on: (_type: string, filter: { table: string }, handler: (payload: unknown) => void) => {
        const listener = { table: filter.table, handler };
        own.push(listener);
        fakeDb.listeners.push(listener);
        return channel;
      },
      subscribe: () => channel,
      unsubscribe: () => {
        fakeDb.listeners = fakeDb.listeners.filter((listener) => !own.includes(listener));
      },
    };
    return channel;
  },
};

export function setClerkTokenGetter() {}
