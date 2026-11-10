import { ActionForm } from "@/components/action-form";
import { redirect } from "next/navigation";
import { milestoneAction, milestoneReviewAction } from "@/server/actions";
import { MilestoneForm } from "@/components/milestone-form";
import { getWorkspace } from "@/server/read";

export const dynamic = "force-dynamic";

export default async function MilestonesPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  const tasks = data.books.tasks.filter((task) => {
    if (data.session.role !== "contributor") return true;
    const person = data.books.people.find((row) => row.id === task.contributorId);
    return person?.userId === data.session.userId;
  });
  return (
    <div className="stack">
      <p className="kicker">Milestones</p>
      <h1 style={{ margin: 0 }}>Work status and payment status stay separate</h1>
      <div className="table-wrap panel">
        <table>
          <thead><tr><th>Title</th><th>Person</th><th>Amount</th><th>Work</th><th>Payment</th><th>Due</th><th></th></tr></thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.title}<div className="kicker">{task.description}</div>{task.evidence && <div>Evidence: {task.evidence}</div>}</td>
                <td>{data.personName(task.contributorId)}</td>
                <td className="num">{data.usdc(task.amountAtomic)}</td>
                <td>{task.workStatus}</td>
                <td>{task.paymentStatus}</td>
                <td>{task.dueOn}</td>
                <td className="stack">
                  {(task.workStatus === "DRAFT" || task.workStatus === "IN_PROGRESS") && (
                    <ActionForm action={milestoneReviewAction}><input type="hidden" name="id" value={task.id} /><input type="hidden" name="intent" value="submit" /><button className="btn" type="submit">Submit</button></ActionForm>
                  )}
                  {data.session.role !== "contributor" && data.session.role !== "auditor" && task.workStatus === "SUBMITTED" && (
                    <ActionForm action={milestoneReviewAction}><input type="hidden" name="id" value={task.id} /><input type="hidden" name="intent" value="review" /><button className="btn" type="submit">Review</button></ActionForm>
                  )}
                  {data.session.role !== "contributor" && data.session.role !== "auditor" && task.workStatus === "UNDER_REVIEW" && (
                    <ActionForm action={milestoneReviewAction}><input type="hidden" name="id" value={task.id} /><input type="hidden" name="intent" value="approve" /><button className="btn mint" type="submit">Approve</button></ActionForm>
                  )}
                  {data.session.role !== "contributor" && data.session.role !== "auditor" && task.workStatus === "UNDER_REVIEW" && (
                    <ActionForm action={milestoneReviewAction} className="stack"><input type="hidden" name="id" value={task.id} /><input type="hidden" name="intent" value="reject" /><input name="reason" placeholder="Reason" required /><button className="btn coral" type="submit">Reject</button></ActionForm>
                  )}
                  {data.session.role === "owner" && task.workStatus === "APPROVED" && task.paymentStatus !== "PAID" && task.paymentStatus !== "UNKNOWN" && (
                    <ActionForm action={milestoneReviewAction}><input type="hidden" name="id" value={task.id} /><input type="hidden" name="intent" value="amend" /><button className="btn" type="submit">Amend</button></ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.session.role !== "auditor" && <MilestoneForm people={data.books.people.map((person) => ({ id: person.id, name: person.displayName }))} action={milestoneAction} />}
    </div>
  );
}
