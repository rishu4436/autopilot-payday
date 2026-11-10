import { redirect } from "next/navigation";
import { ContributorTools } from "@/components/lists";
import { allowlistAction, contributorAction } from "@/server/actions";
import { getWorkspace } from "@/server/read";

export const dynamic = "force-dynamic";

export default async function ContributorsPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  const rows = data.books.people.map((person) => {
    const paid = data.books.tasks.filter((task) => task.contributorId === person.id && task.paymentStatus === "PAID");
    const pending = data.books.tasks.filter((task) => task.contributorId === person.id && task.workStatus !== "APPROVED");
    return {
      id: person.id,
      name: person.displayName,
      role: person.roleTitle,
      address: person.address,
      active: person.active,
      allowlisted: person.allowlisted,
      notes: person.notes,
      paid: data.usdc(paid.reduce((sum, task) => sum + BigInt(task.amountAtomic), 0n)),
      pending: pending.length,
    };
  });
  return (
    <div className="stack">
      <p className="kicker">Contributors</p>
      <h1 style={{ margin: 0 }}>People who can be paid</h1>
      <ContributorTools rows={rows} canEdit={data.session.role === "owner" || data.session.role === "approver"} owner={data.session.role === "owner"} action={contributorAction} allowAction={allowlistAction} />
    </div>
  );
}
