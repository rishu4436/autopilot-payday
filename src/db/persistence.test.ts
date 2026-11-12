import { describe, expect, it } from "vitest";
import { assertPersistentHostDatabase } from "./persistence";
describe("hosted transaction persistence boundary", () => {
  it.each([{ VERCEL: "1" }, { AWS_LAMBDA_FUNCTION_NAME: "payday" }, { NETLIFY: "true" }])("refuses ephemeral transaction journals on a serverless host: %j", (env) => {
    expect(() => assertPersistentHostDatabase(env)).toThrow("persistent PostgreSQL");
  });
  it("permits an explicit hosted database and persistent local development", () => {
    expect(() => assertPersistentHostDatabase({ VERCEL: "1", DATABASE_URL: "postgres://test.invalid/synthetic" })).not.toThrow();
    expect(() => assertPersistentHostDatabase({})).not.toThrow();
  });
});
