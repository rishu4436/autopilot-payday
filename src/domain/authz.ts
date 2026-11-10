export const ROLES = ["owner", "approver", "contributor", "auditor"] as const;
export type Role = (typeof ROLES)[number];

const MATRIX: Record<Role, readonly string[]> = {
  owner: ["*"],
  approver: [
    "read",
    "milestone.approve",
    "milestone.reject",
    "payroll.approve",
    "funding.approve",
    "x402.approve",
    "swap.approve",
  ],
  contributor: ["read.own", "milestone.submit", "milestone.evidence"],
  auditor: ["read"],
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, action: string): boolean {
  const allowed = MATRIX[role];
  return allowed.includes("*") || allowed.includes(action);
}

export function withinApproverLimit(role: Role, amountAtomic: bigint, maxAtomic: bigint): boolean {
  if (role === "owner") return true;
  if (role !== "approver") return false;
  return amountAtomic <= maxAtomic;
}

export class AuthzError extends Error {
  readonly code: "UNAUTHORIZED" | "CROSS_ORG" | "REPLAY" | "EXPIRED";
  constructor(code: AuthzError["code"], message: string) {
    super(message);
    this.name = "AuthzError";
    this.code = code;
  }
}

export function assertSameOrg(sessionOrgId: string, rowOrgId: string): void {
  if (sessionOrgId !== rowOrgId) throw new AuthzError("CROSS_ORG", "Cross-organization access is denied");
}

export function assertCan(role: Role, action: string): void {
  if (!can(role, action)) throw new AuthzError("UNAUTHORIZED", `Role ${role} cannot ${action}`);
}

export function consumeNonce(row: { usedAt: number | null; expiresAt: number }, now: number): void {
  if (row.usedAt !== null) throw new AuthzError("REPLAY", "This sign-in challenge was already used");
  if (now >= row.expiresAt) throw new AuthzError("EXPIRED", "This sign-in challenge has expired");
}

export function buildSignInMessage(input: {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: string;
  expiration: string;
}): string {
  return [
    "Autopilot Payday wants you to sign in.",
    "",
    `Domain: ${input.domain}`,
    `Address: ${input.address}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration: ${input.expiration}`,
  ].join("\n");
}
