import { createNoopCache, normalizeKey, type Cache } from "../cache/index.ts";
import { turnInputSchema, type Member, type PlanningMode, type TurnReport, type TurnResult } from "../domain/contract.ts";
import { mentionedParticipantCount } from "../domain/participants.ts";
import { emptyPlan, type PartyPlan, type VerifiedProduct } from "../domain/plan.ts";
import type { Llm } from "../llm/llm.ts";
import { applyDishOps, dishKey, dishMembers, generateRecipe, recipeFromGenerated, relinkRecipes, syncIngredientRows } from "../scenarios/dinner.ts";
import { checklistNeeds, fitToBudget, generateChecklist } from "../scenarios/event.ts";
import { fallbackShoppingRoute, routeMessage, type Route } from "../scenarios/router.ts";
import type { CatalogSession } from "../silpo/catalog.ts";
import { answerQuestion } from "./answer.ts";
import { unlimitedDeadline, type Deadline } from "./deadline.ts";
import { applyProductOps, type PlannedNeed } from "./edits.ts";
import { addProducts, recalculate, toPlanProduct } from "./plan-builder.ts";
import { formatUah } from "./reply.ts";
import { resolveItems, type ResolvedItem, type ResolveResult } from "./resolve-items.ts";

export type TurnDeps = {
  llm: Llm;
  /** Runs catalog work with the party creator's Silpo connection. */
  withSession: <T>(operation: (session: CatalogSession) => Promise<T>) => Promise<T>;
  /** A member's food restrictions from their Silpo profile. Not given: restrictions are not applied. */
  foodRestrictions?: (memberId: string) => Promise<string[]>;
  cache?: Cache;
  deadline?: Deadline;
  reportStatus?: (status: "THINKING" | "SEARCHING") => Promise<void>;
  createId?: () => string;
};

export const OUT_OF_SCOPE_RESPONSE = "Я можу допомогти з товарами Silpo, рецептами, бюджетом і плануванням покупок для цієї вечірки.";
export const AGENT_UNAVAILABLE_RESPONSE = "Сервіс агента тимчасово не відповідає. Спробуйте ще раз за хвилину.";
const NOTHING_TO_DO_RESPONSE = "Не зрозумів, що змінити. Напишіть, наприклад: «додай 2 кг картоплі і апельсиновий сік».";

/** Translates Silpo setup problems into something the host can act on. */
function contextProblem(message: string | undefined) {
  if (!message) return null;
  if (/renewed|reconnect/i.test(message)) return "Потрібно заново підключити акаунт Сільпо організатора.";
  if (/shopping cart is required/i.test(message)) return "Щоб шукати товари, в організатора має бути активний кошик Сільпо з обраним магазином і часом доставки.";
  if (/timeslot/i.test(message)) return "У кошику Сільпо організатора немає доступного часу доставки. Оберіть новий слот у застосунку Сільпо.";
  return "Сільпо зараз не відповідає. Спробуйте ще раз за хвилину.";
}

function emptyReport(): TurnReport {
  return { added: [], removed: [], quantityChanged: [], unresolved: [], notFoundInPlan: [], unverified: [], notes: [], recipes: [] };
}

/** Everyone's restrictions, read once per turn. An unreadable profile is reported, never fatal. */
async function loadRestrictions(memberIds: string[], deps: TurnDeps, report: TurnReport) {
  const byMember = new Map<string, string[]>();
  if (!deps.foodRestrictions) return byMember;
  let failed = 0;
  await Promise.all(memberIds.map(async (id) => {
    try {
      byMember.set(id, await deps.foodRestrictions!(id));
    } catch (error) {
      failed += 1;
      console.warn("runTurn: food restrictions unavailable", { memberId: id, error });
    }
  }));
  if (failed) report.notes.push(`Не вдалося прочитати харчові обмеження ${failed === 1 ? "одного учасника" : `${failed} учасників`} з Сільпо; перевірте склад товарів самостійно.`);
  return byMember;
}

/** Without the model, a shopping message is still a product list, and an empty event party's first message its brief. */
function routeFor(route: Route | null, mode: PlanningMode, hasPlan: boolean, message: string): Route | null {
  if (route) return route;
  if (mode === "SHOPPING") return fallbackShoppingRoute(message);
  if (mode === "EVENT" && !hasPlan) return { kind: "change", productOps: [], dishOps: [], planEvent: { brief: message } };
  return null;
}

/**
 * One chat turn: routes the message, edits the plan, finds every new product in the Silpo catalog in one pass,
 * and reports item by item what changed and why anything was not added.
 */
export async function runTurn(rawInput: unknown, deps: TurnDeps): Promise<TurnResult> {
  const input = turnInputSchema.parse(rawInput);
  const cache = deps.cache ?? createNoopCache();
  const deadline = deps.deadline ?? unlimitedDeadline;
  const initialPlan = input.plan ?? emptyPlan();
  const memberIds = input.members.map((member) => member.id);
  const unchanged = (text: string): TurnResult => ({ reply: { kind: "message", text }, plan: initialPlan, changedWishes: [] });
  if (!memberIds.includes(input.actorId)) return unchanged("Учасника не знайдено у вечірці.");

  // 1. Route the message to plan changes, a question, or a refusal. Each mode uses only its own operations.
  const route = routeFor(await routeMessage(input, deps.llm), input.mode, initialPlan.products.length > 0, input.message);
  if (!route) return unchanged(AGENT_UNAVAILABLE_RESPONSE);
  if (route.kind === "off_topic") return unchanged(OUT_OF_SCOPE_RESPONSE);
  if (route.kind === "question") return unchanged(await answerQuestion(input, deps.llm));
  const dishOps = input.mode === "DINNER" ? route.dishOps : [];
  const planEvent = input.mode === "EVENT" ? route.planEvent : null;
  if (!route.productOps.length && !dishOps.length && !planEvent) return unchanged(NOTHING_TO_DO_RESPONSE);

  const report = emptyReport();
  const restrictions = await loadRestrictions(memberIds, deps, report);
  const restrictionsOf = (payers: string[]) => [...new Set(payers.flatMap((id) => restrictions.get(id) ?? []))];
  let members: Member[] = input.members;

  // 2. Edits to existing rows need no catalog calls; additions and replacements become needs.
  const edits = applyProductOps(structuredClone(initialPlan), route.productOps, {
    mode: input.mode,
    actorId: input.actorId,
    addAssignees: input.mode === "EVENT" ? memberIds : [input.actorId],
    report,
  });
  let plan: PartyPlan = edits.plan;
  const needs: PlannedNeed[] = edits.needs;

  // 3. Dinner: dish wishes become recipes; the same ingredient is combined across dishes before searching.
  const newRecipeKeys = new Set<string>();
  if (input.mode === "DINNER" && (dishOps.length || edits.replaced.size)) {
    const applied = applyDishOps({ members, plan, actorId: input.actorId, dishOps, createId: deps.createId });
    members = applied.members;
    plan = applied.plan;
    report.notes.push(...applied.notes);
    const generated = await Promise.all(applied.newDishes.map(async (dish) => {
      const eaters = dishMembers(members, dishKey(dish));
      return { dish, eaters, recipe: await generateRecipe(dish, restrictionsOf(eaters), { llm: deps.llm, cache }) };
    }));
    for (const { dish, eaters, recipe } of generated) {
      if (!recipe) {
        report.notes.push(`Не вдалося скласти рецепт «${dish}». Спробуйте ще раз.`);
        continue;
      }
      const created = recipeFromGenerated(dish, recipe, eaters);
      plan = { ...plan, recipes: [...plan.recipes, created] };
      newRecipeKeys.add(created.dishKey!);
    }
    const synced = syncIngredientRows(plan);
    plan = synced.plan;
    const pendingKeys = new Set(needs.map((need) => need.requestKey));
    for (const need of synced.needs) {
      if (!pendingKeys.has(need.key)) needs.push({ ...need, requestKey: need.key, reason: "Інгредієнт для рецептів." });
    }
  }

  // 4. Event: an autonomous checklist for the whole occasion, replacing any earlier plan.
  const eventKeys = new Set<string>();
  if (planEvent) {
    const headcount = mentionedParticipantCount(planEvent.brief) ?? memberIds.length;
    const checklist = await generateChecklist({
      brief: planEvent.brief,
      participantCount: headcount,
      budgetUah: input.budgetUah,
      hasCurrentPlan: initialPlan.products.length > 0,
      restrictions: restrictionsOf(memberIds),
      llm: deps.llm,
    });
    if (!checklist) {
      report.notes.push("Не вдалося скласти план події. Спробуйте ще раз або опишіть подію детальніше.");
    } else {
      if (plan.products.length) {
        report.notes.push("Попередній план замінено новим.");
        plan = { ...plan, products: [], recipes: [] };
      }
      if (headcount !== memberIds.length) {
        report.notes.push(`Кількості розраховано на ${headcount} осіб; суму порівну ділять ${memberIds.length} учасників вечірки.`);
      }
      for (const need of checklistNeeds(checklist, headcount, memberIds)) {
        eventKeys.add(need.key);
        needs.push({ ...need, requestKey: `item:${normalizeKey(need.query)}`, reason: `Подія «${checklist.title}».` });
      }
    }
  }

  // 5. One catalog pass for every product this message needs.
  if (needs.length) {
    await deps.reportStatus?.("SEARCHING");
    for (const need of needs) need.restrictions = restrictionsOf(need.assignedMemberIds);
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
    } else {
      report.unresolved.push(...result.unresolved.map(({ need, reason, suggestions }) => ({
        label: need.label,
        reason,
        suggestions,
        ...(need.brand ? { brand: need.brand } : {}),
        ...(reason === "restricted" ? { restrictions: need.restrictions } : {}),
      })));
    }

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

    // A replacement that found nothing, or only the same product again (e.g. through a learned pick for a
    // generic query), keeps the original row instead of deleting it or reporting it as removed and re-added.
    const productKey = (product: { id: string; lookupProductId?: string }) => product.lookupProductId ?? product.id;
    for (const [key, originals] of edits.replaced) {
      const item = resolved.find((entry) => entry.need.key === key);
      if (item && !originals.some((row) => productKey(row) === productKey(item.product))) continue;
      if (item) resolved = resolved.filter((entry) => entry !== item);
      plan = addProducts(plan, originals).plan;
      report.removed = report.removed.filter((row) => !originals.includes(row));
      report.notes.push(`Не знайшов іншого товару замість «${originals[0].name}», тому залишив його.`);
    }

    const byKey = new Map(needs.map((need) => [need.key, need]));
    const rows: VerifiedProduct[] = resolved.map((item) => {
      const need = byKey.get(item.need.key)!;
      return toPlanProduct(item.product, { quantity: item.quantity, assignedMemberIds: need.assignedMemberIds, reason: need.reason, requestKey: need.requestKey });
    });
    const added = addProducts(plan, rows);
    plan = added.plan;
    report.added.push(...added.changes);
    report.unverified.push(...resolved.filter((item) => item.unverifiedRestrictions.length)
      .map((item) => ({ product: item.product.name, restrictions: item.unverifiedRestrictions })));
  }

  // 6. Dinner bookkeeping: recipes point at the rows that buy their ingredients.
  if (input.mode === "DINNER") {
    plan = relinkRecipes(plan);
    report.recipes.push(...plan.recipes.filter((recipe) => recipe.dishKey && newRecipeKeys.has(recipe.dishKey)));
  }

  plan = recalculate(plan);
  if (input.budgetUah !== null && plan.totalUah > input.budgetUah) {
    report.notes.push(`План перевищує бюджет на ${formatUah(Math.round((plan.totalUah - input.budgetUah) * 100) / 100)}.`);
  }

  const changedWishes = members
    .filter((member) => member.wishes !== input.members.find((original) => original.id === member.id)?.wishes)
    .map(({ id, wishes }) => ({ memberId: id, wishes }));
  return { reply: { kind: "changes", report }, plan, changedWishes };
}
