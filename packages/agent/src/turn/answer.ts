import { MODEL_TIMEOUT_MS } from "../config.ts";
import type { TurnInput } from "../domain/contract.ts";
import type { Llm } from "../llm/llm.ts";
import { formatUah } from "./reply.ts";

const round = (value: number) => Math.round(value * 100) / 100;

/** Per-member totals with the same rules as the web app's cost split (src/lib/cart/costs.ts). */
function memberTotals(input: TurnInput) {
  const ids = input.members.map((member) => member.id);
  const totals = new Map(ids.map((id) => [id, 0]));
  const plan = input.plan;
  if (!plan) return totals;
  if (input.mode === "EVENT") {
    for (const id of ids) totals.set(id, round(plan.totalUah / ids.length));
    return totals;
  }
  for (const product of plan.products) {
    const payers = product.assignedMemberIds.filter((id) => totals.has(id));
    for (const id of payers) totals.set(id, (totals.get(id) ?? 0) + product.lineTotalUah / payers.length);
  }
  return totals;
}

/** Answers a question about the plan from its data; without the model, a plain summary of the member's share. */
export async function answerQuestion(input: TurnInput, llm: Llm) {
  const plan = input.plan;
  const totals = memberTotals(input);
  const answer = await llm.text({
    instructions: "Коротко (1-3 речення) дай відповідь українською на запитання учасника вечірки, використовуючи лише ці дані про план покупок. Суми подавай у гривнях. Не вигадуй товарів і цін. Якщо даних немає, так і скажи.",
    role: "fast",
    timeoutMs: MODEL_TIMEOUT_MS.answer,
    data: {
      question: input.message,
      askedBy: input.actorId,
      mode: input.mode,
      budgetUah: input.budgetUah,
      totalUah: plan?.totalUah ?? 0,
      perMemberUah: Object.fromEntries([...totals].map(([id, value]) => [id, round(value)])),
      products: (plan?.products ?? []).map((product) => ({ name: product.name, quantity: product.quantity, lineTotalUah: product.lineTotalUah, payers: product.assignedMemberIds })),
      recipes: (plan?.recipes ?? []).map((recipe) => ({ title: recipe.title, servings: recipe.servings, missing: recipe.missingIngredients?.map((item) => item.name) ?? [] })),
    },
  });
  if (answer) return answer;
  return plan?.products.length
    ? `У плані ${plan.products.length} товарів на ${formatUah(plan.totalUah)}. Ваша частка — ${formatUah(round(totals.get(input.actorId) ?? 0))}.`
    : "План поки порожній.";
}
