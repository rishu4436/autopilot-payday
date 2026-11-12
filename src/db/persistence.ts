export function assertPersistentHostDatabase(env: Readonly<Record<string, string | undefined>>): void {
  if ((env.VERCEL === "1" || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY === "true") && !env.DATABASE_URL) throw new Error("A hosted serverless deployment requires persistent PostgreSQL via DATABASE_URL; local PGlite cannot safely retain transaction attempts");
}
