export const SCHEMA_SQL = `
create table if not exists treasury_drafts (
  id text primary key, org_id text not null, user_id text not null,
  unsigned_base64 text not null, manifest text not null,
  source_id text, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table if not exists treasury_attempts (
  id text primary key, org_id text not null, batch_id text, proposal_hash text not null,
  message_hash text not null, manifest text not null, approval_signature text not null,
  state text not null check (state in ('PREPARED','SIGNED','UNKNOWN','CONFIRMED','FAILED')),
  signed_base64 text, signature text unique, evidence text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(org_id, proposal_hash), unique(org_id, message_hash)
);
alter table treasury_attempts add column if not exists batch_id text;
alter table treasury_attempts add column if not exists draft_id text;
alter table treasury_attempts add column if not exists source_key text;
alter table treasury_attempts add column if not exists accounting_applied boolean not null default false;
create unique index if not exists treasury_attempt_draft on treasury_attempts(draft_id) where draft_id is not null;
create unique index if not exists treasury_swap_source on treasury_attempts(org_id,source_key) where source_key is not null and state<>'FAILED';
create table if not exists treasury_allocation_claims (
  org_id text not null, milestone_id text not null, attempt_id text not null references treasury_attempts(id),
  allocation_id text not null, recipient text not null, amount_atomic text not null,
  primary key(org_id, milestone_id), unique(org_id, allocation_id)
);
create table if not exists organizations (
  id text primary key,
  name text not null,
  slug text not null unique,
  project_name text not null,
  mode text not null,
  live_enabled boolean not null default false,
  created_at timestamptz not null
);
create table if not exists users (
  id text primary key,
  display_name text not null,
  wallet_address text,
  created_at timestamptz not null
);
create table if not exists sessions (
  id text primary key,
  user_id text not null,
  org_id text not null,
  role text not null,
  auth_mode text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null
);
create table if not exists auth_challenges (
  id text primary key,
  nonce text not null unique,
  domain text not null,
  address text not null,
  message text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null
);
create table if not exists organization_members (
  id text primary key,
  org_id text not null,
  user_id text not null,
  role text not null,
  created_at timestamptz not null
);
create index if not exists auth_challenges_domain_created on auth_challenges(domain, created_at);
create unique index if not exists members_org_user on organization_members(org_id, user_id);
create table if not exists treasury_accounts (
  id text primary key,
  org_id text not null,
  kind text not null,
  address text not null,
  sol_atomic text not null,
  usdc_atomic text not null,
  source text not null,
  observed_at timestamptz not null
);
alter table treasury_accounts add column if not exists observed_slot bigint;
create table if not exists policies (
  id text primary key,
  org_id text not null,
  version integer not null,
  body text not null,
  created_at timestamptz not null
);
create unique index if not exists policies_org_version on policies(org_id, version);
create table if not exists contributors (
  id text primary key,
  org_id text not null,
  user_id text,
  display_name text not null,
  role_title text not null,
  address text not null,
  mint text not null,
  active boolean not null,
  allowlisted boolean not null,
  notes text not null default '',
  created_at timestamptz not null
);
create table if not exists projects (
  id text primary key,
  org_id text not null,
  name text not null,
  summary text not null
);
create table if not exists milestones (
  id text primary key,
  org_id text not null,
  project_id text not null,
  contributor_id text not null,
  title text not null,
  description text not null,
  amount_atomic text not null,
  mint text not null,
  decimals integer not null,
  due_on text not null,
  work_status text not null,
  payment_status text not null,
  evidence text not null default '',
  rejection_reason text not null default '',
  locked_amount text,
  locked_recipient text,
  version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create table if not exists milestone_events (
  id text primary key,
  org_id text not null,
  milestone_id text not null,
  kind text not null,
  actor_id text not null,
  payload text not null,
  created_at timestamptz not null
);
create table if not exists funding_operations (
  id text primary key,
  org_id text not null,
  state text not null,
  blocked_from text,
  idempotency_key text not null,
  policy_version integer not null,
  shortfall_atomic text not null,
  sol_in_atomic text,
  reason text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create table if not exists agent_runs (
  id text primary key,
  org_id text not null,
  operation_id text,
  trigger text not null,
  outcome text not null,
  started_at timestamptz not null,
  finished_at timestamptz
);
create table if not exists agent_decisions (
  id text primary key,
  org_id text not null,
  run_id text not null,
  operation_id text,
  kind text not null,
  code text not null,
  reason text not null,
  next_action text not null,
  observed text not null,
  created_at timestamptz not null
);
create table if not exists x402_calls (
  id text primary key,
  org_id text not null,
  operation_id text,
  endpoint text not null,
  evidence_class text not null,
  http_status integer,
  amount_atomic text,
  pay_to text,
  asset text,
  network text,
  request_json text not null,
  response_json text not null,
  receipt_signature text,
  created_at timestamptz not null
);
create table if not exists swap_quotes (
  id text primary key,
  org_id text not null,
  operation_id text not null,
  call_id text,
  provider_key text not null,
  input_atomic text not null,
  output_atomic text,
  min_out_atomic text,
  slippage_bps integer not null,
  price_impact text,
  provider_quote text not null,
  evidence_class text not null,
  expires_at timestamptz not null,
  selected boolean not null default false,
  created_at timestamptz not null
);
create table if not exists swap_executions (
  id text primary key,
  org_id text not null,
  operation_id text not null,
  quote_id text not null,
  unsigned_tx text,
  signature text,
  status text not null,
  evidence_class text not null,
  detail text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create table if not exists payroll_batches (
  id text primary key,
  org_id text not null,
  status text not null,
  total_atomic text not null,
  operation_id text,
  proposal_hash text,
  evidence_class text not null,
  created_at timestamptz not null
);
create table if not exists payroll_items (
  id text primary key,
  batch_id text not null,
  milestone_id text not null unique,
  amount_atomic text not null,
  recipient text not null,
  status text not null
);
create table if not exists payout_transactions (
  id text primary key,
  org_id text not null,
  batch_id text not null,
  chunk_index integer not null,
  signature text,
  status text not null,
  evidence_class text not null,
  detail text not null,
  created_at timestamptz not null
);
create unique index if not exists payout_batch_chunk on payout_transactions(batch_id, chunk_index);
create table if not exists authorizations (
  id text primary key,
  org_id text not null,
  subject_type text not null,
  subject_id text not null,
  actor_id text not null,
  proposal_hash text not null,
  decision text not null,
  created_at timestamptz not null
);
create table if not exists audit_events (
  id text primary key,
  org_id text not null,
  actor_id text not null,
  action text not null,
  entity text not null,
  entity_id text not null,
  data text not null,
  created_at timestamptz not null
);
create table if not exists notifications (
  id text primary key,
  org_id text not null,
  kind text not null,
  title text not null,
  body text not null,
  group_key text not null,
  read_at timestamptz,
  created_at timestamptz not null
);
create table if not exists jobs (
  id text primary key,
  org_id text not null,
  kind text not null,
  status text not null,
  payload text not null,
  attempts integer not null,
  max_attempts integer not null,
  run_at timestamptz not null,
  locked_until timestamptz,
  lock_token text,
  last_error text,
  idempotency_key text not null
);
create unique index if not exists jobs_idem on jobs(org_id, idempotency_key);
create table if not exists locks (
  name text primary key,
  owner text not null,
  expires_at timestamptz not null
);
create table if not exists idempotency (
  scope text not null,
  key text not null,
  status text not null,
  response text not null,
  created_at timestamptz not null,
  primary key (scope, key)
);
create table if not exists proof_shares (
  id text primary key,
  org_id text not null,
  batch_id text not null,
  token text not null unique,
  include_addresses boolean not null,
  expires_at timestamptz not null,
  created_at timestamptz not null
);
create table if not exists saved_reports (
  id text primary key,
  org_id text not null,
  name text not null,
  kind text not null,
  params text not null,
  created_at timestamptz not null
);
`;
