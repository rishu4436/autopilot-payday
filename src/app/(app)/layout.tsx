import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { getWorkspace } from "@/server/read";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const workspace = await getWorkspace();
  if (!workspace) redirect("/login");
  const jar = await cookies();
  return (
    <Shell
      flash={jar.get("ap_flash")?.value ?? null}
      role={workspace.session.role}
      name={workspace.session.displayName}
      authMode={workspace.session.authMode}
      orgMode={workspace.books.org.mode}
      orgName={workspace.books.org.name}
      paused={workspace.books.policy.paused}
      pending={workspace.pending}
      unread={workspace.unread}
    >
      {children}
    </Shell>
  );
}
