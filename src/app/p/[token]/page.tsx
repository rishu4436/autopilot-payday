import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { batches, batchItems, milestones, contributors } from "@/db/schema";
import { proofShares } from "@/db/schema";
import { formatAtomic } from "@/domain/money";
import { maskAddress } from "@/server/text";
import { evidenceLabel } from "@/solana/address";

export const dynamic = "force-dynamic";

export default async function PublicProof({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const share = (await db.select().from(proofShares).where(eq(proofShares.token, token)).limit(1))[0];
  if (!share || share.expiresAt.getTime() < Date.now()) notFound();
  const batch = (await db.select().from(batches).where(eq(batches.id, share.batchId)).limit(1))[0];
  if (!batch || batch.orgId !== share.orgId) notFound();
  const items = await db.select().from(batchItems).where(eq(batchItems.batchId, batch.id));
  const tasks = await db.select().from(milestones).where(eq(milestones.orgId, share.orgId));
  const people = await db.select().from(contributors).where(eq(contributors.orgId, share.orgId));
  return (
    <main className="main" style={{ maxWidth: 760, margin: "0 auto" }}>
      <p className="kicker">Shared proof</p>
      <h1>Read-only payday record</h1>
      <p><span className="badge">{evidenceLabel(batch.evidenceClass)}</span> {formatAtomic(BigInt(batch.totalAtomic), 6)} USDC · {batch.status}</p>
      <p>Addresses are {share.includeAddresses ? "included because the owner allowed it" : "masked"}.</p>
      {items.map((item) => {
        const task = tasks.find((row) => row.id === item.milestoneId);
        const person = people.find((row) => row.id === task?.contributorId);
        const address = share.includeAddresses ? item.recipient : maskAddress(item.recipient);
        return <section key={item.id} className="panel"><strong>{person?.displayName ?? "Contributor"}</strong><p>{task?.title}</p><p>{formatAtomic(BigInt(item.amountAtomic), 6)} USDC · {address}</p></section>;
      })}
    </main>
  );
}
