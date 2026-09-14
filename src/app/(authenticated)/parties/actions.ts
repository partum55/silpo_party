"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { finalizeCart } from "@/lib/cart/service";
import { createParty, deleteParty, joinPartyByCode, leaveParty, updatePartyBudget, type PartyMode } from "@/lib/party/service";
import { extractJoinCode } from "@/lib/party/join-code";
import { RuleViolation } from "@/lib/party/rules";

export async function createPartyAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const rawMode = String(formData.get("mode") ?? "EVENT");
  const mode: PartyMode = rawMode === "SHOPPING" || rawMode === "DINNER" ? rawMode : "EVENT";
  const rawBudget = String(formData.get("budgetUah") ?? "").trim();
  const budgetUah = rawBudget ? Number(rawBudget) : null;
  if (!name) redirect("/?error=name_required");
  if (budgetUah !== null && (!Number.isFinite(budgetUah) || budgetUah < 0)) redirect("/?error=invalid_budget");

  let partyId: string;
  try {
    partyId = (await createParty(user.id, name, mode, budgetUah)).id;
  } catch (error) {
    if (error instanceof RuleViolation) redirect(`/?error=${error.code}`);
    throw error;
  }
  redirect(`/parties/${partyId}`);
}

export async function updatePartyBudgetAction(formData: FormData) {
  const user = await requireUser();
  const partyId = String(formData.get("partyId") ?? "");
  const rawBudget = String(formData.get("budgetUah") ?? "").trim();
  const budgetUah = rawBudget ? Number(rawBudget) : null;
  if (budgetUah !== null && (!Number.isFinite(budgetUah) || budgetUah < 0)) {
    redirect(`/parties/${partyId}?error=invalid_budget`);
  }
  try {
    await updatePartyBudget(partyId, user.id, budgetUah);
  } catch (error) {
    if (error instanceof RuleViolation) redirect(`/parties/${partyId}?error=${error.code}`);
    throw error;
  }
  revalidatePath(`/parties/${partyId}`);
}

export async function joinPartyAction(formData: FormData) {
  const user = await requireUser();
  const joinCode = extractJoinCode(String(formData.get("joinCode") ?? ""));
  if (!joinCode) redirect("/?error=join_code_required");

  let partyId: string;
  try {
    partyId = (await joinPartyByCode(joinCode, user.id)).id;
  } catch (error) {
    if (error instanceof RuleViolation) redirect(`/?error=${error.code}`);
    throw error;
  }
  redirect(`/parties/${partyId}`);
}

export async function leavePartyAction(formData: FormData) {
  const user = await requireUser();
  const partyId = String(formData.get("partyId"));
  try {
    await leaveParty(partyId, user.id);
  } catch (error) {
    if (error instanceof RuleViolation) redirect(`/parties/${partyId}?error=${error.code}`);
    throw error;
  }
  redirect("/");
}

export async function deletePartyAction(formData: FormData) {
  const user = await requireUser();
  const partyId = String(formData.get("partyId"));
  try {
    await deleteParty(partyId, user.id);
  } catch (error) {
    if (error instanceof RuleViolation) redirect(`/parties/${partyId}?error=${error.code}`);
    throw error;
  }
  redirect("/");
}

export async function finalizeCartAction(formData: FormData) {
  const user = await requireUser();
  const partyId = String(formData.get("partyId"));
  try {
    await finalizeCart(partyId, user.id);
  } catch (error) {
    if (!(error instanceof RuleViolation)) throw error;
  }
  revalidatePath(`/parties/${partyId}`);
  redirect(`/parties/${partyId}?tab=plan`);
}
