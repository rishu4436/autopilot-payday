# Database

Drizzle schema: `src/db/schema.ts`. Bootstrap SQL: `src/db/sql.ts`. The server runs the SQL on startup with `CREATE TABLE IF NOT EXISTS`. It does not drop or overwrite an existing Northstar organization.

## Drivers

- Default: `@electric-sql/pglite` in `PGLITE_DIR` (`data/pglite`).
- Production: set `DATABASE_URL`. `docker compose up` starts Postgres 16 with user `autopilot`, password `autopilot`, database `autopilot`.

```powershell
docker compose up -d
```

Put this in `.env.local`:

```
DATABASE_URL=postgres://autopilot:autopilot@localhost:5432/autopilot
```

Restart the app. The same SQL runs against Postgres.

## Seed

`pnpm db:seed` opens the database. If slug `northstar` is missing, the demo organization is inserted once.

The seed is fictional:

- Organization Northstar Studio, project Product Launch.
- Maya, Leo, and Aria.
- Approved unpaid payroll of 40 + 50 + 35 = 125 USDC.
- Treasury USDC 35. Shortfall 90.
- Treasury SOL 12.5 with a 0.05 SOL reserve.
- API wallet 2.5 USDC with a 1 USDC reserve.
- One earlier workshop payout marked `simulated`.

Demo public keys were generated and the secret keys were discarded. They are not funded.

Atomic amounts are stored as decimal strings, with mint and decimals beside them.

## Idempotency

`payroll_items.milestone_id` is unique. `idempotency` is keyed by scope and key. `jobs` are unique per organization and idempotency key. `locks` covers funding actions for about 20 seconds.

Deleting `data/pglite` wipes the local ledger. There is no in-app reset button.
# Independent audit amendment — 2026-11-10

Demo fixtures cannot be promoted to live, and external PostgreSQL is not seeded without explicit dedicated-demo opt-in. `getDb` shares one initialization promise. Organization mutations use a database transaction with a held row lock, and nested writes share that transaction. Payout chunks have a unique batch/chunk index and allocations remain unique by milestone. Partial/unknown payments are held for reconciliation. Tests reproduce rollback/concurrency on PGlite; external PostgreSQL and live treasury crash recovery remain unverified. See [AUDIT-REPORT.md](AUDIT-REPORT.md).

