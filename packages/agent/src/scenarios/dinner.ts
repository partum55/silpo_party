import { z } from "zod";

import { cacheTtl, normalizeKey, type Cache } from "../cache/index.ts";
import { MODEL_TIMEOUT_MS, RECIPE_BASE_SERVINGS } from "../config.ts";
import type { Member } from "../domain/contract.ts";
import { isPantryStaple } from "../domain/pantry.ts";
import { measureUnitSchema, type MeasureUnit, type PartyPlan, type VerifiedRecipe } from "../domain/plan.ts";
import { productLineTotalUah } from "../domain/purchasing.ts";
import { purchaseQuantity } from "../domain/quantity.ts";
import type { Llm } from "../llm/llm.ts";
import type { ItemNeed } from "../turn/resolve-items.ts";

const generatedRecipeSchema = z.object({
  title: z.string().min(1),
  ingredients: z.array(z.object({
    name: z.string().min(1),
    amount: z.number().positive(),
    unit: measureUnitSchema,
  })).min(1).max(15),
  steps: z.array(z.string().min(1)).min(1).max(12),
});

export type GeneratedRecipe = z.output<typeof generatedRecipeSchema>;

const RECIPE_INSTRUCTIONS = `Write a practical home-cooked recipe for the requested dish, for ${RECIPE_BASE_SERVINGS} servings, as a Ukrainian cook would make it from supermarket ingredients.
Title and steps in Ukrainian. Each ingredient "name" is a short Ukrainian supermarket search term in the nominative case naming one product (e.g. "спагеті", "бекон", "сир пармезан", "яйця курячі", "цибуля ріпчаста").
Omit pantry staples every kitchen has: salt, black pepper, water, cooking oil, sugar, vinegar, dry spices.
Units: "g" for solid food including vegetables and meat, "ml" for liquids, "piece" only for eggs and similar countable packaged items. Amounts are totals for all ${RECIPE_BASE_SERVINGS} servings.
Do not suggest a ready-made or semi-finished version of the dish. 3-12 steps.
If "restrictions" are given (allergies or diets of the people eating it), every ingredient must respect them: leave out or substitute anything that conflicts.`;

export const dishKey = (dish: string) => normalizeKey(dish);
const ingredientKey = (name: string, unit: MeasureUnit) => `ingredient:${normalizeKey(name)}:${unit}`;

/** A recipe for a dish, cached per dish and restriction set (a nut-free pesto is a different recipe). */
export async function generateRecipe(dish: string, restrictions: string[], { llm, cache }: { llm: Llm; cache: Cache }): Promise<GeneratedRecipe | null> {
  const restrictionKey = [...new Set(restrictions.map(normalizeKey))].sort().join(",");
  return cache.getOrLoad(`recipe:${dishKey(dish)}${restrictionKey ? `:${restrictionKey}` : ""}`, cacheTtl.recipe, () => llm.json(generatedRecipeSchema, {
    instructions: RECIPE_INSTRUCTIONS,
    role: "smart",
    timeoutMs: MODEL_TIMEOUT_MS.recipe,
    data: { dish, ...(restrictions.length ? { restrictions } : {}) },
  }), { shouldCache: (recipe) => recipe !== null });
}

type DishOp = { action: "add" | "remove"; dish: string; servings?: number | null };

/**
 * Applies dish requests to the actor's wishes and to recipe membership. A dish another member already
 * requested is shared: the actor joins that recipe instead of creating a duplicate. An add with servings sets
 * the recipe's portion count, so "на 2 порції" rescales ingredients instead of doubling packages.
 */
export function applyDishOps({
  members: initialMembers,
  plan,
  actorId,
  dishOps,
  createId = () => crypto.randomUUID(),
}: {
  members: Member[];
  plan: PartyPlan;
  actorId: string;
  dishOps: DishOp[];
  createId?: () => string;
}) {
  let members = initialMembers;
  let recipes = plan.recipes;
  const newDishes: Array<{ dish: string; servings?: number }> = [];
  const rescaledKeys = new Set<string>();
  const notes: string[] = [];
  const recipeFor = (key: string) => recipes.find((recipe) => (recipe.dishKey ?? dishKey(recipe.title)) === key);

  for (const op of dishOps) {
    const key = dishKey(op.dish);
    const actor = members.find((member) => member.id === actorId);
    if (!actor || !key) continue;
    const ownWish = actor.wishes.find((wish) => wish.fulfillmentStrategy === "recipe" && dishKey(wish.text) === key)
      ?? (op.action === "remove"
        ? actor.wishes.find((wish) => wish.fulfillmentStrategy === "recipe" && (dishKey(wish.text).includes(key) || key.includes(dishKey(wish.text))))
        : undefined);

    if (op.action === "add") {
      if (!ownWish) {
        members = members.map((member) => member.id === actorId
          ? { ...member, wishes: [...member.wishes, { id: createId(), text: op.dish, fulfillmentStrategy: "recipe" as const }] }
          : member);
      }
      const existing = recipeFor(key);
      const servings = op.servings ? Math.round(op.servings) : undefined;
      if (existing && servings && servings !== recipeServings(existing)) {
        recipes = recipes.map((recipe) => recipe === existing ? {
          ...recipe,
          requestedServings: servings,
          assignedMemberIds: [...new Set([...recipe.assignedMemberIds, actorId])].sort(),
        } : recipe);
        rescaledKeys.add(key);
      } else if (existing) {
        if (!existing.assignedMemberIds.includes(actorId)) {
          recipes = recipes.map((recipe) => recipe === existing ? { ...recipe, assignedMemberIds: [...recipe.assignedMemberIds, actorId].sort() } : recipe);
        } else {
          notes.push(`Страва «${existing.title}» вже є у плані.`);
        }
      } else if (!newDishes.some((item) => dishKey(item.dish) === key)) {
        newDishes.push({ dish: op.dish, ...(servings ? { servings } : {}) });
      }
      continue;
    }

    if (!ownWish) {
      notes.push(`Страви «${op.dish}» немає серед ваших побажань.`);
      continue;
    }
    members = members.map((member) => member.id === actorId
      ? { ...member, wishes: member.wishes.filter((wish) => wish.id !== ownWish.id) }
      : member);
    const recipe = recipeFor(dishKey(ownWish.text));
    if (recipe) {
      const remaining = recipe.assignedMemberIds.filter((id) => id !== actorId);
      recipes = remaining.length
        ? recipes.map((item) => item === recipe ? { ...item, assignedMemberIds: remaining } : item)
        : recipes.filter((item) => item !== recipe);
    }
  }
  return { members, plan: { ...plan, recipes }, newDishes, rescaledKeys, notes };
}

/** Members (sorted) who asked for a dish, by its normalized key. */
export function dishMembers(members: Member[], key: string) {
  return members
    .filter((member) => member.wishes.some((wish) => wish.fulfillmentStrategy === "recipe" && dishKey(wish.text) === key))
    .map((member) => member.id)
    .sort();
}

export function recipeFromGenerated(dish: string, generated: GeneratedRecipe, assignedMemberIds: string[], requestedServings?: number): VerifiedRecipe {
  const ingredients = generated.ingredients.filter((ingredient) => !isPantryStaple(ingredient.name));
  const servings = requestedServings ?? Math.max(1, assignedMemberIds.length);
  return {
    title: generated.title,
    dishKey: dishKey(dish),
    source: "generated",
    sourceUrl: null,
    baseServings: RECIPE_BASE_SERVINGS,
    servings,
    ...(requestedServings ? { requestedServings } : {}),
    assignedMemberIds,
    ingredients: [],
    // Every ingredient starts as missing; relinkRecipes attaches the purchased product once it is resolved.
    missingIngredients: ingredients.map((ingredient) => ({
      name: ingredient.name,
      baseAmount: ingredient.amount,
      requiredAmount: round(ingredient.amount * servings / RECIPE_BASE_SERVINGS),
      unit: ingredient.unit,
    })),
    steps: generated.steps,
  };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

function ingredientDefinitions(recipe: VerifiedRecipe) {
  return [
    ...recipe.ingredients.map(({ name, baseAmount, unit }) => ({ name, baseAmount, unit })),
    ...(recipe.missingIngredients ?? []).map(({ name, baseAmount, unit }) => ({ name, baseAmount, unit })),
  ];
}

const recipeServings = (recipe: VerifiedRecipe) => recipe.requestedServings ?? Math.max(1, recipe.assignedMemberIds.length);

type AggregatedIngredient = { key: string; name: string; unit: MeasureUnit; amount: number; memberIds: string[] };

/** Sums the same ingredient across every recipe, scaled to how many members want each dish. */
function aggregateIngredients(recipes: VerifiedRecipe[]): AggregatedIngredient[] {
  const aggregated = new Map<string, AggregatedIngredient>();
  for (const recipe of recipes) {
    const scale = recipeServings(recipe) / recipe.baseServings;
    for (const ingredient of ingredientDefinitions(recipe)) {
      const key = ingredientKey(ingredient.name, ingredient.unit);
      const entry = aggregated.get(key) ?? { key, name: ingredient.name, unit: ingredient.unit, amount: 0, memberIds: [] };
      entry.amount = round(entry.amount + ingredient.baseAmount * scale);
      entry.memberIds = [...new Set([...entry.memberIds, ...recipe.assignedMemberIds])].sort();
      aggregated.set(key, entry);
    }
  }
  return [...aggregated.values()];
}

/**
 * Brings ingredient rows in line with the recipes: updates quantities and payers of rows already bought,
 * drops rows no recipe needs any more, and returns needs for ingredients that still have to be found.
 */
export function syncIngredientRows(plan: PartyPlan) {
  const excluded = new Set(plan.excludedIngredientKeys);
  const aggregated = aggregateIngredients(plan.recipes).filter((ingredient) => !excluded.has(ingredient.key));
  const byKey = new Map(aggregated.map((ingredient) => [ingredient.key, ingredient]));
  const covered = new Set<string>();
  const products = plan.products.flatMap((product) => {
    if (!product.requestKey?.startsWith("ingredient:")) return [product];
    const ingredient = byKey.get(product.requestKey);
    if (!ingredient || covered.has(ingredient.key)) return [];
    covered.add(ingredient.key);
    const quantity = purchaseQuantity({ amount: ingredient.amount, unit: ingredient.unit }, product);
    return [{
      ...product,
      quantity,
      assignedMemberIds: ingredient.memberIds,
      lineTotalUah: productLineTotalUah(product, quantity),
    }];
  });
  const needs: ItemNeed[] = aggregated.filter((ingredient) => !covered.has(ingredient.key)).map((ingredient) => ({
    key: ingredient.key,
    label: ingredient.name,
    query: ingredient.name,
    requested: { amount: ingredient.amount, unit: ingredient.unit },
    assignedMemberIds: ingredient.memberIds,
  }));
  return { plan: { ...plan, products }, needs };
}

/** Points every recipe ingredient at the plan row that buys it, or lists it as missing. */
export function relinkRecipes(plan: PartyPlan): PartyPlan {
  const rows = new Map(plan.products.flatMap((product) => product.requestKey?.startsWith("ingredient:") ? [[product.requestKey, product] as const] : []));
  return {
    ...plan,
    recipes: plan.recipes.map((recipe) => {
      const servings = recipeServings(recipe);
      const scale = servings / recipe.baseServings;
      const ingredients: VerifiedRecipe["ingredients"] = [];
      const missingIngredients: NonNullable<VerifiedRecipe["missingIngredients"]> = [];
      for (const definition of ingredientDefinitions(recipe)) {
        const requiredAmount = round(definition.baseAmount * scale);
        const row = rows.get(ingredientKey(definition.name, definition.unit));
        if (row) {
          ingredients.push({
            ...definition,
            requiredAmount,
            purchaseQuantity: Math.max(1, Math.round(row.quantity)),
            purchasedAmount: row.packageSize.amount * Math.max(1, Math.round(row.quantity)),
            selectedProduct: row,
          });
        } else {
          missingIngredients.push({ ...definition, requiredAmount });
        }
      }
      return { ...recipe, servings, ingredients, missingIngredients };
    }),
  };
}
