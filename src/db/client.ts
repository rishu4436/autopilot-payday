import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";
import { SCHEMA_SQL } from "./sql";
import { seedIfEmpty } from "./seed";

export type AppDb = PgliteDatabase<typeof schema>;
const transactionContext = new AsyncLocalStorage<AppDb>();
export function inTransaction<T>(db: AppDb, work: () => Promise<T>): Promise<T> {
  return transactionContext.run(db, work);
}

const globalForDb = globalThis as unknown as {
  paydayDb?: AppDb;
  paydayReady?: Promise<void>;
  paydayOpening?: Promise<AppDb>;
};

async function open(): Promise<AppDb> {
  if (process.env.DATABASE_URL) {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const sql = postgres(process.env.DATABASE_URL, { max: 5 });
    await sql.unsafe(SCHEMA_SQL);
    return drizzle(sql, { schema }) as unknown as AppDb;
  }
  const dir = path.resolve(process.cwd(), process.env.PGLITE_DIR ?? "data/pglite");
  fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.waitReady;
  await client.exec(SCHEMA_SQL);
  return drizzlePglite(client, { schema });
}

export async function getDb(): Promise<AppDb> {
  const tx = transactionContext.getStore();
  if (tx) return tx;
  globalForDb.paydayOpening ??= (async () => {
    const db = await open();
    await seedIfEmpty(db);
    globalForDb.paydayDb = db;
    return db;
  })();
  return globalForDb.paydayOpening;
}
