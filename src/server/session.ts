import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { members, organizations, sessions, users } from "@/db/schema";
import { isRole, type Role } from "@/domain/authz";

export interface Session {
  id: string;
  userId: string;
  orgId: string;
  role: Role;
  authMode: string;
  displayName: string;
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const id = jar.get("ap_session")?.value;
  if (!id) return null;
  const db = await getDb();
  const row = (await db.select().from(sessions).where(eq(sessions.id, id)).limit(1))[0];
  if (!row || row.expiresAt.getTime() <= Date.now() || !isRole(row.role)) return null;
  const member = (await db.select().from(members).where(and(eq(members.userId, row.userId), eq(members.orgId, row.orgId))).limit(1))[0];
  const org = (await db.select().from(organizations).where(eq(organizations.id, row.orgId)).limit(1))[0];
  if (!member || member.role !== row.role || !org) return null;
  if (row.authMode === "demo" && ((process.env.APP_MODE || "demo") !== "demo" || org.mode !== "demo")) return null;
  if (row.authMode !== "demo" && row.authMode !== "wallet") return null;
  const user = (await db.select().from(users).where(eq(users.id, row.userId)).limit(1))[0];
  if (!user) return null;
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId,
    role: row.role,
    authMode: row.authMode,
    displayName: user.displayName,
  };
}

export async function setSessionCookie(id: string): Promise<void> {
  const jar = await cookies();
  jar.set("ap_session", id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !(process.env.COOKIE_SECURE === "false" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(process.env.APP_ORIGIN || "")),
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete("ap_session");
}
