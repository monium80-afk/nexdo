// A fake Supabase for store tests: keeps rows per table in memory, applies
// upserts and deletes the way PostgREST would (one call = one statement), and
// logs every write so a test can check exactly what reached the database.

type Row = Record<string, unknown> & { id: string };
type Filter = { column: string; values: unknown[] };

export const fakeDb = {
  tables: new Map<string, Map<string, Row>>(),
  /** One entry per request: what it was and how many rows it carried. */
  writes: [] as { table: string; kind: "upsert" | "delete"; ids: string[] }[],
  /** Set to make the next write fail with this PostgREST error. */
  nextError: null as { code: string; message: string } | null,
  /** Columns the fake "database" doesn't have (PGRST204 when named). */
  missingColumns: new Set<string>(),
  reset() {
    this.tables.clear();
    this.writes = [];
    this.nextError = null;
    this.missingColumns.clear();
  },
  rows(table: string): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])];
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
    order() {
      return builder;
    },
    upsert(input: Row | Row[]) {
      const rows = Array.isArray(input) ? input : [input];
      const missing = rows.flatMap((row) => Object.keys(row)).find((key) => fakeDb.missingColumns.has(key));
      if (missing) {
        return Promise.resolve({ error: { code: "PGRST204", message: `Could not find the '${missing}' column` } });
      }
      const error = takeError();
      if (error) return Promise.resolve({ error });
      rows.forEach((row) => table(name).set(row.id, { ...row }));
      fakeDb.writes.push({ table: name, kind: "upsert", ids: rows.map((row) => row.id) });
      return Promise.resolve({ error: null });
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
      return resolve({ data: [...table(name).values()].filter((row) => matches(row, filters)), error: null });
    },
  };
  return builder;
}

export const supabase = {
  from: (name: string) => query(name),
  channel: () => {
    const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => undefined };
    return channel;
  },
};

export function setClerkTokenGetter() {}
