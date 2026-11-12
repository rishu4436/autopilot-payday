// PGlite returns {rows}; postgres-js returns a RowList array. Keep raw SQL
// authorization/CAS checks identical on both drivers, including nested transactions.
export function normalizePostgresResults<T extends object>(database: T): T {
  return new Proxy(database, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "execute" && typeof value === "function") return async (...args: unknown[]) => {
        const result: unknown = await Reflect.apply(value, target, args);
        if (Array.isArray(result)) return { rows: result, rowCount: (result as unknown as { count?: number }).count ?? result.length };
        if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result;
        throw new Error("Unsupported database result shape; transaction state cannot be trusted");
      };
      if (key === "transaction" && typeof value === "function") return (work: (tx: object) => unknown, ...options: unknown[]) => Reflect.apply(value, target, [(tx: object) => work(normalizePostgresResults(tx)), ...options]);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
