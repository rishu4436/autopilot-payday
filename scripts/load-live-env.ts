// Local operator commands only. Next loads its own deployment environment.
// Existing terminal values take precedence; this file never reads a wallet.
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
const file = process.env.PAYDAY_LIVE_ENV_FILE || ".env.live.local";
if (existsSync(file)) loadEnvFile(file);
else if (process.env.PAYDAY_LIVE_ENV_FILE) throw new Error("PAYDAY_LIVE_ENV_FILE does not exist");
