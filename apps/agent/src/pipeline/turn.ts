import { createNoopCache, normalizeKey, type Cache } from "../cache/index.ts";
import { mentionedParticipantCount } from "../domain/participants.ts";
import { emptyPlan, type PartyPlanDraft, type VerifiedProduct, type VerifiedRecipe } from "../domain/plan.ts";
import type { Party, TurnInput, TurnOutput } from "../domain/turn-schema.ts";
import type { Warning } from "../domain/schemas.ts";
import type { Llm } from "../llm/json.ts";
import {
  applyDishOps,
  dinnerWishFulfillments,
  dishKey,
  dishMembers,
  formatRecipes,
  generateRecipe,
  recipeFromGenerated,
  relinkRecipes,
  syncIngredientRows,
} from "../scenarios/dinner.ts";
import { checklistNeeds, fitToBudget, generateChecklist } from "../scenarios/event.ts";
import { fallbackShoppingRoute, routeMessage, type ProductOp, type Route } from "../scenarios/router.ts";
import type { CatalogSession } from "../silpo/catalog.ts";
import { unlimitedDeadline, type Deadline } from "./deadline.ts";
import { addProducts, findPlanProducts, finishPlan, removeRows, setRowQuantity, toPlanProduct } from "./plan-builder.ts";
import { resolveItems, type ItemNeed, type ResolveResult, type ResolvedItem, type UnresolvedItem } from "./resolve-items.ts";
import { buildResponseText, formatUah, type TurnReport } from "./response.ts";

export type TurnDeps = {
  llm: Llm;
  withSession: <T>(operation: (session: CatalogSession) => Promise<T>) => Promise<T>;
  cache?: Cache;
  deadline?: Deadline;
  reportStatus?: (status: "THINKING" | "SEARCHING") => Promise<void>;
  createId?: () => string;
};

export const OUT_OF_SCOPE_RESPONSE = "Я можу допомогти з товарами Silpo, рецептами, бюджетом і плануванням покупок для цієї вечірки.";
export const AGENT_UNAVAILABLE_RESPONSE = "Сервіс агента тимчасово не відповідає. Спробуйте ще раз за хвилину.";
const NOTHING_TO_DO_RESPONSE = "Не зрозумів, що змінити. Напишіть, наприклад: «додай 2 кг картоплі і апельсиновий сік».";

type PlannedNeed = ItemNeed & { requestKey: string; reason: string; priority?: "essential" | "extra" };

function preferences(party: Party) {
  return party.members.map(({ id: memberId, wishes, status }) => ({ memberId, wishes, status }));
}

export function readOnlyResult(input: TurnInput, responseText: string): TurnOutput {
  return {
    responseText,
    intent: "read_only",
    preferenceOperations: [],
    planOperations: [],
    updatedPreferences: preferences(input.currentParty),
    updatedPlan: input.currentPlan,
    blockers: [],
    warnings: [],
    questions: [],
    readiness: input.readiness,
  };
}

/** Translates Silpo setup problems into something the host can act on. */
function contextProblem(message: string | undefined) {
  if (!message) return null;
  if (/renewed|reconnect/i.test(message)) return "Потрібно заново підключити акаунт Сільпо організатора.";
  if (/shopping cart is required/i.test(message)) return "Щоб шукати товари, в організатора має бути активний кошик Сільпо з обраним магазином і часом доставки.";
  if (/timeslot/i.test(message)) return "У кошику Сільпо організатора немає доступного часу доставки. Оберіть новий слот у застосунку Сільпо.";
  return "Сільпо зараз не відповідає. Спробуйте ще раз за хвилину.";
}

/** Per-member totals with the same rules as the web app's cost split (src/lib/cart/costs.ts). */
function memberTotals(input: TurnInput) {
  const plan = input.currentPlan;
  const ids = input.currentParty.members.map((member) => member.id);
  const totals = new Map(ids.map((id) => [id, 0]));
  if (!plan) return totals;
  if (input.mode === "EVENT") {
    for (const id of ids) totals.set(id, Math.round(plan.totalUah / Math.max(1, ids.length) * 100) / 100);
    return totals;
  }
  for (const product of plan.products) {
    const payers = product.assignedMemberIds.filter((id) => totals.has(id));
    for (const id of payers) totals.set(id, (totals.get(id) ?? 0) + product.lineTotalUah / payers.length);
  }
  return totals;
}

async function answerQuestion(input: TurnInput, llm: Llm) {
  const plan = input.currentPlan;
  const totals = memberTotals(input);
  const answer = await llm.text({
    instructions: "Коротко (1-3 речення) дай відповідь українською на запитання учасника вечірки, використовуючи лише ці дані про план покупок. Суми подавай у гривнях. Не вигадуй товарів і цін. Якщо даних немає, так і скажи.",
    role: "fast",
    timeoutMs: 15_000,
    data: {
      question: input.message,
      askedBy: input.actorId,
      mode: input.mode,
      budgetUah: input.budgetUah,
      totalUah: plan?.totalUah ?? 0,
      perMemberUah: Object.fromEntries([...totals].map(([id, value]) => [id, Math.round(value * 100) / 100])),
      products: (plan?.products ?? []).map((product) => ({ name: product.name, quantity: product.quantity, lineTotalUah: product.lineTotalUah, payers: product.assignedMemberIds })),
      recipes: (plan?.recipes ?? []).map((recipe) => ({ title: recipe.title, servings: recipe.servings, missing: recipe.missingIngredients?.map((item) => item.name) ?? [] })),
    },
  });
  if (answer) return answer;
  const mine = totals.get(input.actorId) ?? 0;
  return plan?.products.length
    ? `У плані ${plan.products.length} товарів на ${formatUah(plan.totalUah)}. Ваша частка — ${formatUah(Math.round(mine * 100) / 100)}.`
    : "План поки порожній.";
}

function productNeed(op: ProductOp, index: number, assignedMemberIds: string[], reason: string, requestKey?: string): PlannedNeed {
  return {
    key: `op:${index}`,
    label: op.label,
    query: op.query,
    altQueries: op.altQueries,
    requested: { count: op.count, amount: op.amount, unit: op.unit },
    assignedMemberIds,
    requestKey: requestKey ?? `item:${normalizeKey(op.query)}`,
    reason,
  };
}

/** Rows a message refers to; in shopping mode a member's own rows win over someone else's. */
function targetRows(plan: PartyPlanDraft, op: ProductOp, input: TurnInput) {
  const rows = findPlanProducts(plan, op.target ?? op.query);
  if (input.mode !== "SHOPPING") return rows;
  const own = rows.filter((row) => row.assignedMemberIds.includes(input.actorId));
  return own.length ? own : rows;
}

function sanitizeRoute(route: Route, mode: TurnInput["mode"]): Route {
  return {
    ...route,
    dishOps: mode === "DINNER" ? route.dishOps : [],
    planEvent: mode === "EVENT" ? route.planEvent : null,
  };
}

export async function runTurn(input: TurnInput, deps: TurnDeps): Promise<TurnOutput> {
  const cache = deps.cache ?? createNoopCache();
  const deadline = deps.deadline ?? unlimitedDeadline;
  const memberIds = input.currentParty.members.map((member) => member.id);
  if (!memberIds.includes(input.actorId)) return readOnlyResult(input, "Учасника не знайдено у вечірці.");

  let route = await routeMessage(input, deps.llm);
  if (!route && input.mode === "SHOPPING") route = fallbackShoppingRoute(input.message);
  if (!route && input.mode === "EVENT" && !input.currentPlan?.products.length) {
    route = { kind: "change", productOps: [], dishOps: [], planEvent: { brief: input.message } };
  }
  if (!route) return readOnlyResult(input, AGENT_UNAVAILABLE_RESPONSE);
  if (route.kind === "off_topic") return readOnlyResult(input, OUT_OF_SCOPE_RESPONSE);
  if (route.kind === "question") return readOnlyResult(input, await answerQuestion(input, deps.llm));
  route = sanitizeRoute(route, input.mode);
  if (!route.productOps.length && !route.dishOps.length && !route.planEvent) return readOnlyResult(input, NOTHING_TO_DO_RESPONSE);

  let plan: PartyPlanDraft = structuredClone(input.currentPlan ?? emptyPlan());
  let party: Party = structuredClone(input.currentParty);
  const report: Required<Omit<TurnReport, "totalUah">> = { added: [], removed: [], quantityChanged: [], unresolved: [], notFoundInPlan: [], notes: [] };
  const warnings: Warning[] = [];
  const needs: PlannedNeed[] = [];
  const unresolvedAll: UnresolvedItem[] = [];
  const addAssignees = input.mode === "EVENT" ? memberIds : [input.actorId];
  const directReason = input.mode === "EVENT" ? "Спільна покупка для події." : "Запит учасника.";

  // 1. Edits to existing rows need no catalog calls.
  route.productOps.forEach((op, index) => {
    if (op.action === "add") {
      needs.push(productNeed(op, index, addAssignees, directReason));
      return;
    }
    const rows = targetRows(plan, op, input);
    if (!rows.length) {
      report.notFoundInPlan.push(op.target ?? op.label);
      if (op.action === "replace") needs.push(productNeed(op, index, addAssignees, directReason));
      return;
    }
    if (op.action === "remove") {
      plan = removeRows(plan, rows);
      report.removed.push(...rows);
    } else if (op.action === "set_quantity") {
      if (!op.count) {
        report.notes.push(`Не зрозумів нову кількість для «${op.label}».`);
        return;
      }
      for (const row of rows) plan = setRowQuantity(plan, row, op.count);
      report.quantityChanged.push(...rows.map((row) => ({ ...row, quantity: Math.round(op.count!) })));
    } else {
      // Replacement keeps the need (and its recipe link) but buys a different product for the same people.
      plan = removeRows(plan, rows, { exclude: false });
      report.removed.push(...rows);
      const assignees = [...new Set(rows.flatMap((row) => row.assignedMemberIds))];
      const requestKey = rows.find((row) => row.requestKey)?.requestKey;
      needs.push(productNeed(op, index, assignees, rows[0].reason, requestKey));
    }
  });

  // 2. Dinner: dish wishes become recipes; shared ingredients are combined before searching.
  const newRecipeKeys = new Set<string>();
  const hadIngredientChange = route.productOps.some((op) => op.action === "replace");
  if (input.mode === "DINNER" && (route.dishOps.length || hadIngredientChange)) {
    const applied = applyDishOps({ party, plan, actorId: input.actorId, dishOps: route.dishOps, createId: deps.createId });
    party = applied.party;
    plan = applied.plan;
    report.notes.push(...applied.notes);
    const generated = await Promise.all(applied.newDishes.map(async (dish) => ({ dish, recipe: await generateRecipe(dish, { llm: deps.llm, cache }) })));
    for (const { dish, recipe } of generated) {
      if (!recipe) {
        report.notes.push(`Не вдалося скласти рецепт «${dish}». Спробуйте ще раз.`);
        continue;
      }
      const created = recipeFromGenerated(dish, recipe, dishMembers(party, dishKey(dish)));
      plan = { ...plan, recipes: [...plan.recipes, created] };
      newRecipeKeys.add(created.dishKey!);
    }
    const synced = syncIngredientRows(plan);
    plan = synced.plan;
    const pendingKeys = new Set(needs.map((need) => need.requestKey));
    for (const need of synced.needs) {
      if (pendingKeys.has(need.key)) continue;
      needs.push({ ...need, requestKey: need.key, reason: "Інгредієнт для рецептів." });
    }
  }

  // 3. Event: an autonomous checklist for the whole occasion.
  let eventKeys = new Set<string>();
  if (input.mode === "EVENT" && route.planEvent) {
    const headcount = mentionedParticipantCount(route.planEvent.brief) ?? memberIds.length;
    const checklist = await generateChecklist({
      brief: route.planEvent.brief,
      participantCount: headcount,
      budgetUah: input.budgetUah,
      hasCurrentPlan: Boolean(input.currentPlan?.products.length),
      llm: deps.llm,
    });
    if (!checklist) {
      report.notes.push("Не вдалося скласти план події. Спробуйте ще раз або опишіть подію детальніше.");
    } else {
      if (plan.products.length) {
        report.notes.push("Попередній план замінено новим.");
        plan = { ...plan, products: [], recipes: [], wishFulfillments: [] };
      }
      if (headcount !== memberIds.length) {
        report.notes.push(`Кількості розраховано на ${headcount} осіб; суму порівну ділять ${memberIds.length} учасників вечірки.`);
      }
      const eventNeeds = checklistNeeds(checklist, headcount, memberIds);
      eventKeys = new Set(eventNeeds.map((need) => need.key));
      needs.push(...eventNeeds.map((need) => ({ ...need, requestKey: `item:${normalizeKey(need.query)}`, reason: `Подія «${checklist.title}».` })));
    }
  }

  // 4. One catalog pass for every product this message needs.
  if (needs.length) {
    await deps.reportStatus?.("SEARCHING");
    let result: ResolveResult;
    try {
      result = await deps.withSession((session) => resolveItems(needs, { session, llm: deps.llm, cache, deadline }));
    } catch (error) {
      console.error("runTurn: Silpo session failed", error);
      result = {
        resolved: [],
        unresolved: needs.map((need) => ({ need, reason: "mcp_error" as const, suggestions: [] })),
        contextError: error instanceof Error ? error.message : String(error),
      };
    }
    const problem = contextProblem(result.contextError);
    if (problem) {
      // Nothing could be searched at all: one actionable message instead of the same reason per item.
      report.notes.unshift(`${problem} Не додано: ${result.unresolved.map((item) => `«${item.need.label}»`).join(", ")}.`);
    }
    unresolvedAll.push(...result.unresolved);

    let resolved: ResolvedItem[] = result.resolved;
    if (eventKeys.size) {
      const priorities = new Map(needs.map((need) => [need.key, need.priority ?? "essential"]));
      const eventItems = resolved.filter((item) => eventKeys.has(item.need.key)).map((item) => ({ ...item, priority: priorities.get(item.need.key)! }));
      const others = resolved.filter((item) => !eventKeys.has(item.need.key));
      const otherSpend = plan.totalUah + others.reduce((sum, item) => sum + item.lineTotalUah, 0);
      const fitted = fitToBudget(eventItems, input.budgetUah, otherSpend);
      if (fitted.dropped.length) report.notes.push(`Щоб вкластися в бюджет, не додано: ${fitted.dropped.map((item) => `«${item.need.label}»`).join(", ")}.`);
      if (fitted.swapped.length) report.notes.push(`Для бюджету обрано дешевші варіанти: ${fitted.swapped.map((item) => `«${item.product.name}»`).join(", ")}.`);
      resolved = [...others, ...fitted.items];
    }

    const byKey = new Map(needs.map((need) => [need.key, need]));
    const rows: VerifiedProduct[] = resolved.map((item) => {
      const need = byKey.get(item.need.key)!;
      return toPlanProduct(item.product, {
        quantity: item.quantity,
        assignedMemberIds: need.assignedMemberIds,
        reason: need.reason,
        requestKey: need.requestKey,
      });
    });
    const added = addProducts(plan, rows);
    plan = added.plan;
    report.added.push(...added.changes);
    if (!problem) report.unresolved.push(...result.unresolved);
  }

  // 5. Dinner bookkeeping: recipes point at the rows that buy their ingredients.
  let recipeText = "";
  if (input.mode === "DINNER") {
    plan = relinkRecipes(plan);
    plan = { ...plan, wishFulfillments: dinnerWishFulfillments(party, plan) };
    const fresh: VerifiedRecipe[] = plan.recipes.filter((recipe) => recipe.dishKey && newRecipeKeys.has(recipe.dishKey));
    recipeText = formatRecipes(fresh);
  }

  const finished = finishPlan(plan, memberIds);
  if (input.budgetUah !== null && finished.totalUah > input.budgetUah) {
    const amountUah = Math.round((finished.totalUah - input.budgetUah) * 100) / 100;
    const message = `План перевищує бюджет на ${formatUah(amountUah)}.`;
    warnings.push({ code: "budget_exceeded", message, amountUah });
    report.notes.push(message);
  }

  const summary = buildResponseText({ ...report, totalUah: finished.totalUah });
  return {
    responseText: recipeText ? `${summary}\n\n${recipeText}` : summary,
    intent: route.dishOps.length ? "preference_mutation" : "plan_mutation",
    preferenceOperations: [],
    planOperations: [],
    updatedPreferences: preferences(party),
    updatedPlan: finished,
    blockers: unresolvedAll.map((item) => ({ code: "product_not_found" as const, message: `«${item.need.label}»: ${item.reason}` })),
    warnings,
    questions: [],
    readiness: unresolvedAll.length ? "invalid" : "ready",
  };
}
