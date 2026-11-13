"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  analyze,
  approveSwap,
  buyQuote,
  cancelOperation,
  captureChallenge,
  decideBatch,
  finishChallenge,
  loginDemo,
  logout,
  makeBatch,
  markPartial,
  markRead,
  prepareLivePayout,
  refillDemo,
  refreshBalances,
  registerWallet,
  reviewMilestone,
  saveContributor,
  saveMilestone,
  savePolicy,
  setAllowlist,
  setMode,
  setPaused,
  settleDemoPayout,
  settleDemoSwap,
  shareProof,
  startChallenge,
  submitSignedSwap,
} from "./mutate";
import { getSession, type Session } from "./session";
import { fail, type ActionState } from "./text";
import { requestDomain } from "./request-security";

async function run(work: (session: Session) => Promise<ActionState>): Promise<ActionState> {
  await requestDomain();
  const session = await getSession();
  if (!session) return fail("Sign in required");
  let result: ActionState;
  try {
    result = await work(session);
  } catch (error) {
    result = fail(error instanceof Error ? error.message : "The action failed. Inspect its state before retrying.");
  }
  if (result?.message) {
    const jar = await cookies();
    jar.set("ap_flash", result.message.slice(0, 400), { path: "/", maxAge: 12, sameSite: "lax" });
  }
  revalidatePath("/");
  return result;
}

export async function loginDemoAction(formData: FormData): Promise<void> {
  await requestDomain();
  const result = await loginDemo(String(formData.get("role") ?? ""));
  if (!result?.ok) throw new Error(result?.message ?? "Sign-in failed");
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await requestDomain();
  await logout();
  redirect("/login");
}

export async function walletChallengeAction(address: string, domain: string) {
  if (domain !== await requestDomain()) return fail("Sign-in domain mismatch");
  return startChallenge(address, domain);
}

export async function walletVerifyAction(address: string, signature: string, nonce: string): Promise<ActionState> {
  const result = await finishChallenge(address, signature, nonce, await requestDomain());
  return result;
}

export async function contributorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((session) => saveContributor(session, {
    id: String(formData.get("id") ?? "") || undefined,
    displayName: String(formData.get("displayName") ?? "").slice(0, 80),
    roleTitle: String(formData.get("roleTitle") ?? "").slice(0, 80),
    address: String(formData.get("address") ?? "").trim(),
    notes: String(formData.get("notes") ?? "").slice(0, 500),
    active: formData.get("active") === "on",
  }));
}

export async function allowlistAction(formData: FormData): Promise<void> {
  await run((session) => setAllowlist(session, String(formData.get("id")), formData.get("allowlisted") === "true"));
}

export async function milestoneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((session) => saveMilestone(session, {
    id: String(formData.get("id") ?? "") || undefined,
    title: String(formData.get("title") ?? "").slice(0, 120),
    description: String(formData.get("description") ?? "").slice(0, 2000),
    contributorId: String(formData.get("contributorId") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    dueOn: String(formData.get("dueOn") ?? ""),
    evidence: String(formData.get("evidence") ?? "").slice(0, 2000),
  }));
}

export async function milestoneReviewAction(formData: FormData): Promise<void> {
  await run((session) => reviewMilestone(
    session,
    String(formData.get("id")),
    String(formData.get("intent")) as "submit" | "review" | "approve" | "reject" | "amend",
    String(formData.get("reason") ?? ""),
  ));
}

export async function analyzeAction(formData: FormData): Promise<void> {
  await run((session) => analyze(session, String(formData.get("sol") ?? "")));
}

export async function quoteAction(): Promise<void> {
  await run((session) => buyQuote(session));
}

export async function swapAction(): Promise<void> {
  await run((session) => approveSwap(session));
}

export async function settleSwapAction(): Promise<void> {
  await run((session) => settleDemoSwap(session));
}

export async function cancelAction(): Promise<void> {
  await run((session) => cancelOperation(session));
}

export async function pauseAction(formData: FormData): Promise<void> {
  await run((session) => setPaused(session, formData.get("paused") === "true"));
}

export async function batchAction(formData: FormData): Promise<ActionState> {
  return run((session) => makeBatch(session, formData.getAll("milestoneId").map(String)));
}

export async function batchDecisionAction(formData: FormData): Promise<ActionState> {
  return run((session) => decideBatch(session, String(formData.get("id")), formData.get("decision") === "approved" ? "approved" : "rejected", String(formData.get("reason") ?? "")));
}

export async function payoutAction(formData: FormData): Promise<void> {
  await run((session) => settleDemoPayout(session, String(formData.get("id"))));
}

export async function partialAction(formData: FormData): Promise<void> {
  await run((session) => markPartial(session, String(formData.get("id"))));
}

export async function preparePayoutAction(formData: FormData): Promise<void> {
  await run((session) => prepareLivePayout(session, String(formData.get("id"))));
}

export async function policyAction(formData: FormData): Promise<void> {
  const patch: Record<string, string> = {};
  for (const key of ["minSol", "minUsdc", "minX402", "threshold", "minRefill", "maxRefill", "perCall", "daily", "approverMax", "slippage", "quoteAge", "margin", "agentName", "purpose", "executionMode"]) {
    patch[key] = String(formData.get(key) ?? "");
  }
  await run((session) => savePolicy(session, patch));
}

export async function modeAction(formData: FormData): Promise<void> {
  await run((session) => setMode(session, String(formData.get("mode")), formData.get("liveEnabled") === "on"));
}

export async function refreshAction(): Promise<void> {
  await run((session) => refreshBalances(session));
}

export async function challengeAction(formData: FormData): Promise<void> {
  await run((session) => captureChallenge(session, String(formData.get("sol") ?? "1")));
}

export async function readAction(): Promise<void> {
  await run((session) => markRead(session));
}

export async function shareAction(formData: FormData): Promise<void> {
  await run((session) => shareProof(session, String(formData.get("id")), formData.get("includeAddresses") === "on"));
}

export async function walletRegisterAction(formData: FormData): Promise<void> {
  await run((session) => registerWallet(session, String(formData.get("userId")), String(formData.get("address") ?? "")));
}

export async function signedSwapAction(formData: FormData): Promise<void> {
  await run((session) => submitSignedSwap(session, String(formData.get("signed") ?? "")));
}

export async function refillAction(formData: FormData): Promise<void> {
  await run((session) => refillDemo(session, String(formData.get("amount") ?? "")));
}
