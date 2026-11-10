import { boolean, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" }).notNull();

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  projectName: text("project_name").notNull(),
  mode: text("mode").notNull(),
  liveEnabled: boolean("live_enabled").notNull().default(false),
  createdAt: ts("created_at"),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  walletAddress: text("wallet_address"),
  createdAt: ts("created_at"),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  orgId: text("org_id").notNull(),
  role: text("role").notNull(),
  authMode: text("auth_mode").notNull(),
  expiresAt: ts("expires_at"),
  createdAt: ts("created_at"),
});

export const authChallenges = pgTable("auth_challenges", {
  id: text("id").primaryKey(),
  nonce: text("nonce").notNull().unique(),
  domain: text("domain").notNull(),
  address: text("address").notNull(),
  message: text("message").notNull(),
  expiresAt: ts("expires_at"),
  usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
  createdAt: ts("created_at"),
});

export const members = pgTable("organization_members", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(),
  createdAt: ts("created_at"),
}, (table) => [uniqueIndex("members_org_user").on(table.orgId, table.userId)]);

export const treasuryAccounts = pgTable("treasury_accounts", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),
  address: text("address").notNull(),
  solAtomic: text("sol_atomic").notNull(),
  usdcAtomic: text("usdc_atomic").notNull(),
  source: text("source").notNull(),
  observedAt: ts("observed_at"),
});

export const policies = pgTable("policies", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  version: integer("version").notNull(),
  body: text("body").notNull(),
  createdAt: ts("created_at"),
}, (table) => [uniqueIndex("policies_org_version").on(table.orgId, table.version)]);

export const contributors = pgTable("contributors", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  userId: text("user_id"),
  displayName: text("display_name").notNull(),
  roleTitle: text("role_title").notNull(),
  address: text("address").notNull(),
  mint: text("mint").notNull(),
  active: boolean("active").notNull(),
  allowlisted: boolean("allowlisted").notNull(),
  notes: text("notes").notNull().default(""),
  createdAt: ts("created_at"),
});

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
});

export const milestones = pgTable("milestones", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  projectId: text("project_id").notNull(),
  contributorId: text("contributor_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  amountAtomic: text("amount_atomic").notNull(),
  mint: text("mint").notNull(),
  decimals: integer("decimals").notNull(),
  dueOn: text("due_on").notNull(),
  workStatus: text("work_status").notNull(),
  paymentStatus: text("payment_status").notNull(),
  evidence: text("evidence").notNull().default(""),
  rejectionReason: text("rejection_reason").notNull().default(""),
  lockedAmount: text("locked_amount"),
  lockedRecipient: text("locked_recipient"),
  version: integer("version").notNull(),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

export const milestoneEvents = pgTable("milestone_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  milestoneId: text("milestone_id").notNull(),
  kind: text("kind").notNull(),
  actorId: text("actor_id").notNull(),
  payload: text("payload").notNull(),
  createdAt: ts("created_at"),
});

export const operations = pgTable("funding_operations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  state: text("state").notNull(),
  blockedFrom: text("blocked_from"),
  idempotencyKey: text("idempotency_key").notNull(),
  policyVersion: integer("policy_version").notNull(),
  shortfallAtomic: text("shortfall_atomic").notNull(),
  solInAtomic: text("sol_in_atomic"),
  reason: text("reason").notNull().default(""),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

export const runs = pgTable("agent_runs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  operationId: text("operation_id"),
  trigger: text("trigger").notNull(),
  outcome: text("outcome").notNull(),
  startedAt: ts("started_at"),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
});

export const decisions = pgTable("agent_decisions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  runId: text("run_id").notNull(),
  operationId: text("operation_id"),
  kind: text("kind").notNull(),
  code: text("code").notNull(),
  reason: text("reason").notNull(),
  nextAction: text("next_action").notNull(),
  observed: text("observed").notNull(),
  createdAt: ts("created_at"),
});

export const x402Calls = pgTable("x402_calls", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  operationId: text("operation_id"),
  endpoint: text("endpoint").notNull(),
  evidenceClass: text("evidence_class").notNull(),
  httpStatus: integer("http_status"),
  amountAtomic: text("amount_atomic"),
  payTo: text("pay_to"),
  asset: text("asset"),
  network: text("network"),
  requestJson: text("request_json").notNull(),
  responseJson: text("response_json").notNull(),
  receiptSignature: text("receipt_signature"),
  createdAt: ts("created_at"),
});

export const quotes = pgTable("swap_quotes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  operationId: text("operation_id").notNull(),
  callId: text("call_id"),
  providerKey: text("provider_key").notNull(),
  inputAtomic: text("input_atomic").notNull(),
  outputAtomic: text("output_atomic"),
  minOutAtomic: text("min_out_atomic"),
  slippageBps: integer("slippage_bps").notNull(),
  priceImpact: text("price_impact"),
  providerQuote: text("provider_quote").notNull(),
  evidenceClass: text("evidence_class").notNull(),
  expiresAt: ts("expires_at"),
  selected: boolean("selected").notNull().default(false),
  createdAt: ts("created_at"),
});

export const swapExecutions = pgTable("swap_executions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  operationId: text("operation_id").notNull(),
  quoteId: text("quote_id").notNull(),
  unsignedTx: text("unsigned_tx"),
  signature: text("signature"),
  status: text("status").notNull(),
  evidenceClass: text("evidence_class").notNull(),
  detail: text("detail").notNull(),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

export const batches = pgTable("payroll_batches", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  status: text("status").notNull(),
  totalAtomic: text("total_atomic").notNull(),
  operationId: text("operation_id"),
  proposalHash: text("proposal_hash"),
  evidenceClass: text("evidence_class").notNull(),
  createdAt: ts("created_at"),
});

export const batchItems = pgTable("payroll_items", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  milestoneId: text("milestone_id").notNull().unique(),
  amountAtomic: text("amount_atomic").notNull(),
  recipient: text("recipient").notNull(),
  status: text("status").notNull(),
});

export const payoutTxs = pgTable("payout_transactions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  batchId: text("batch_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  signature: text("signature"),
  status: text("status").notNull(),
  evidenceClass: text("evidence_class").notNull(),
  detail: text("detail").notNull(),
  createdAt: ts("created_at"),
});

export const authorizations = pgTable("authorizations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  actorId: text("actor_id").notNull(),
  proposalHash: text("proposal_hash").notNull(),
  decision: text("decision").notNull(),
  createdAt: ts("created_at"),
});

export const audits = pgTable("audit_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  data: text("data").notNull(),
  createdAt: ts("created_at"),
});

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  groupKey: text("group_key").notNull(),
  readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
  createdAt: ts("created_at"),
});

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  payload: text("payload").notNull(),
  attempts: integer("attempts").notNull(),
  maxAttempts: integer("max_attempts").notNull(),
  runAt: ts("run_at"),
  lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
  lockToken: text("lock_token"),
  lastError: text("last_error"),
  idempotencyKey: text("idempotency_key").notNull(),
});

export const locks = pgTable("locks", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: ts("expires_at"),
});

export const idempotency = pgTable("idempotency", {
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  status: text("status").notNull(),
  response: text("response").notNull(),
  createdAt: ts("created_at"),
}, (table) => [primaryKey({ columns: [table.scope, table.key] })]);

export const proofShares = pgTable("proof_shares", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  batchId: text("batch_id").notNull(),
  token: text("token").notNull().unique(),
  includeAddresses: boolean("include_addresses").notNull(),
  expiresAt: ts("expires_at"),
  createdAt: ts("created_at"),
});

export const reports = pgTable("saved_reports", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  params: text("params").notNull(),
  createdAt: ts("created_at"),
});
