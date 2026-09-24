import { z } from "zod";

import { eventPlanningGuidance } from "../domain/event-guidance.ts";
import { measureUnitSchema } from "../domain/plan.ts";
import { productLineTotalUah } from "../domain/purchasing.ts";
import { purchaseQuantity } from "../domain/quantity.ts";
import type { Llm } from "../llm/json.ts";
import type { ItemNeed, ResolvedItem } from "../pipeline/resolve-items.ts";

export const checklistSchema = z.object({
  title: z.string().min(1),
  items: z.array(z.object({
    category: z.string().min(1),
    label: z.string().min(1),
    query: z.string().min(1),
    altQueries: z.array(z.string().min(1)).max(2).default([]),
    /** Amount per person (with unit) for food and drinks consumed per head. */
    perPerson: z.number().positive().nullable().default(null),
    unit: measureUnitSchema.nullable().default(null),
    /** Fixed number of packages for shared items (charcoal, napkins, one sauce jar per table). */
    count: z.number().int().positive().nullable().default(null),
    priority: z.enum(["essential", "extra"]),
  })).min(2).max(20),
});

export type Checklist = z.output<typeof checklistSchema>;

const CHECKLIST_INSTRUCTIONS = `Plan the complete shopping list for a group event in Ukraine, bought at the Silpo supermarket.
Think through the whole event: main food, sides, bread, vegetables, sauces, drinks (including non-alcoholic), snacks or dessert, and non-food essentials the occasion needs (for a barbecue: charcoal, lighter fluid, disposable tableware).
Each item: "category" (e.g. "м'ясо", "гарнір", "напої", "соуси", "посуд"), "label" (Ukrainian display name), "query" (short Ukrainian catalog search term in the nominative case naming one product), "altQueries" (up to two alternatives).
Quantities: for food and drinks eaten per person give "perPerson" with "unit" ("g" or "ml"; e.g. shashlik meat 300 g, drinks 500 ml per drink type); for shared items give "count" of packages instead.
Mark core items "essential" and nice-to-have items "extra". With a budget, keep essentials affordable and add extras only if the budget comfortably allows. 6-15 items.`;

export async function generateChecklist({
  brief,
  participantCount,
  budgetUah,
  hasCurrentPlan,
  llm,
}: {
  brief: string;
  participantCount: number;
  budgetUah: number | null;
  hasCurrentPlan: boolean;
  llm: Llm;
}) {
  return llm.json(checklistSchema, {
    instructions: CHECKLIST_INSTRUCTIONS,
    role: "smart",
    timeoutMs: 45_000,
    data: {
      brief,
      participantCount,
      budgetUah,
      guidance: eventPlanningGuidance({ message: brief, participantCount, hasCurrentPlan }),
    },
  });
}

export function checklistNeeds(checklist: Checklist, participantCount: number, memberIds: string[]): Array<ItemNeed & { priority: "essential" | "extra" }> {
  return checklist.items.map((item, index) => ({
    key: `event:${index}`,
    label: item.label,
    query: item.query,
    altQueries: item.altQueries,
    requested: item.perPerson && item.unit
      ? { amount: item.perPerson * participantCount, unit: item.unit }
      : { count: item.count ?? 1 },
    assignedMemberIds: memberIds,
    priority: item.priority,
  }));
}

/**
 * Fits event purchases into a budget: first drops optional extras (last listed first), then swaps essentials
 * for the cheapest suitable alternative found during search. Returns what was dropped and swapped.
 */
export function fitToBudget(
  items: Array<ResolvedItem & { priority: "essential" | "extra" }>,
  budgetUah: number | null,
  otherSpendUah = 0,
) {
  if (budgetUah === null) return { items, dropped: [] as ResolvedItem[], swapped: [] as ResolvedItem[] };
  const total = (list: ResolvedItem[]) => otherSpendUah + list.reduce((sum, item) => sum + item.lineTotalUah, 0);
  let kept = [...items];
  const dropped: ResolvedItem[] = [];
  for (let index = kept.length - 1; index >= 0 && total(kept) > budgetUah; index -= 1) {
    if (kept[index].priority !== "extra") continue;
    dropped.push(kept[index]);
    kept = kept.filter((_, position) => position !== index);
  }
  const swapped: ResolvedItem[] = [];
  if (total(kept) > budgetUah) {
    kept = kept.map((item) => {
      const cheaper = item.alternatives
        .map((product) => {
          const quantity = purchaseQuantity(item.need.requested ?? {}, product);
          return { product, quantity, lineTotalUah: productLineTotalUah(product, quantity) };
        })
        .filter((option) => option.lineTotalUah < item.lineTotalUah)
        .sort((left, right) => left.lineTotalUah - right.lineTotalUah)[0];
      if (!cheaper) return item;
      const next = { ...item, ...cheaper, alternatives: [] };
      swapped.push(next);
      return next;
    });
  }
  return { items: kept, dropped, swapped };
}
