import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { normalizePostgresResults } from "./postgres-results";

// A test-only PostgreSQL wire endpoint around PGlite's actual PostgreSQL engine.
// Exercises the installed postgres-js/Drizzle driver and savepoints, not a mocked
// RowList. No external database, Docker daemon or real transaction is accessed.
let engine: PGlite, server: Server, client: ReturnType<typeof postgres>;
const sockets = new Set<Socket>();
function packet(type: string, body: Buffer) { const header = Buffer.alloc(5); header[0] = type.charCodeAt(0); header.writeInt32BE(body.length + 4, 1); return Buffer.concat([header, body]); }
beforeAll(async () => {
  engine = new PGlite(); await engine.waitReady;
  server = createServer((socket) => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0), started = false, queue = Promise.resolve();
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (!started) {
        if (pending.length < 4 || pending.length < pending.readInt32BE(0)) return;
        const length = pending.readInt32BE(0), protocol = pending.readInt32BE(4);
        pending = pending.subarray(length);
        if (protocol !== 196608) { socket.destroy(); return; }
        started = true;
        socket.write(packet("R", Buffer.alloc(4)));
        for (const [name, value] of [["server_version", "17.0"], ["server_encoding", "UTF8"], ["client_encoding", "UTF8"], ["DateStyle", "ISO, MDY"], ["integer_datetimes", "on"], ["standard_conforming_strings", "on"], ["TimeZone", "UTC"]]) socket.write(packet("S", Buffer.from(`${name}\0${value}\0`)));
        socket.write(packet("K", Buffer.alloc(8))); socket.write(packet("Z", Buffer.from("I")));
      }
      while (pending.length >= 5 && pending.length >= 1 + pending.readInt32BE(1)) {
        const length = 1 + pending.readInt32BE(1), message = Buffer.from(pending.subarray(0, length)); pending = pending.subarray(length);
        if (message[0] === 88) { socket.end(); return; }
        queue = queue.then(async () => { const output = await engine.execProtocolRaw(message, { syncToFs: false }); if (output.length) socket.write(output); }).catch(() => { socket.destroy(); });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing synthetic PostgreSQL port");
  client = postgres({ host: "127.0.0.1", port: address.port, database: "postgres", username: "postgres", max: 1, ssl: false, prepare: false, fetch_types: false, connect_timeout: 5, idle_timeout: 1 });
}, 60_000);
afterAll(async () => { await client?.end({ timeout: 1 }); for (const socket of sockets) socket.destroy(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); await engine?.close(); });

describe("native postgres-js result compatibility over a real PostgreSQL wire protocol", () => {
  it("normalizes RowList authorization/CAS results and nested transaction rollback", async () => {
    const raw = drizzle(client), adapted = normalizePostgresResults(raw);
    const native = await raw.execute(sql`select 1 as owner_count`);
    expect(Array.isArray(native)).toBe(true); expect("rows" in native).toBe(false);
    const owner = await adapted.execute(sql`select 1 as owner_count`) as unknown as { rows: { owner_count: number }[] };
    expect(owner.rows[0]?.owner_count).toBe(1);
    await adapted.execute(sql`create table synthetic_attempts(id text primary key,state text not null)`);
    await adapted.transaction(async (tx) => {
      await tx.execute(sql`insert into synthetic_attempts values ('one','PREPARED')`);
      await expect(tx.transaction(async (nested) => { await nested.execute(sql`update synthetic_attempts set state='INVALID' where id='one'`); throw new Error("injected SQL rollback"); })).rejects.toThrow("injected");
      const result = await tx.execute(sql`update synthetic_attempts set state='SIGNED' where id='one' and state='PREPARED' returning id`) as unknown as { rows: { id: string }[] };
      expect(result.rows).toEqual([{ id: "one" }]);
    });
    const claim = await adapted.execute(sql`update synthetic_attempts set state='UNKNOWN' where id='one' and state='SIGNED' returning id`) as unknown as { rows: { id: string }[] };
    expect(claim.rows).toHaveLength(1);
    const duplicate = await adapted.execute(sql`update synthetic_attempts set state='UNKNOWN' where id='one' and state='SIGNED' returning id`) as unknown as { rows: unknown[] };
    expect(duplicate.rows).toHaveLength(0);
  });
});
