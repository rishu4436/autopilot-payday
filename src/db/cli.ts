import { getDb } from "./client";

const command = process.argv[2];
if (command === "seed") {
  await getDb();
  console.log("Database ready. Demo seed runs only when Northstar is absent.");
} else {
  console.error("Usage: tsx src/db/cli.ts seed");
  process.exit(1);
}
