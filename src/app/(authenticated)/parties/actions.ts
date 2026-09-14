"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { finalizeCart } from "@/lib/cart/service";
import { createParty, deleteParty, joinPartyByCode, leaveParty } from "@/lib/party/service";
import { RuleViolation } from "@/lib/party/rules";

export async function createPartyAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/?error=name_required");

  let partyId: string;
  try {
    partyId = (await createParty(user.id, name)).id;
  } catch (error) {
    if (error instanceof RuleViolation) redirect(`/?error=${error.code}`);
    throw error;
  }
  redirect(`/parties/${partyId}`);
}

export async function joinPartyAction(formData: FormData) {
  const user = await requireUser();
  const joinCode = String(formData.get("joinCode") ?? "").trim();
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
  redirect(`/parties/${partyId}`);
}
