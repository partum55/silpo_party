import { z } from "zod";

import { cacheTtl, normalizeKey, type Cache } from "../cache/index.ts";
import { isPantryStaple } from "../domain/pantry.ts";
import { measureUnitSchema, type MeasureUnit, type PartyPlanDraft, type VerifiedRecipe, type WishFulfillment } from "../domain/plan.ts";
import { productLineTotalUah } from "../domain/purchasing.ts";
import { formatMeasure, purchaseQuantity } from "../domain/quantity.ts";
import type { Party } from "../domain/turn-schema.ts";
import type { Llm } from "../llm/json.ts";
import type { ItemNeed } from "../pipeline/resolve-items.ts";

/** Recipes are generated for this many servings and scaled to the number of members who want the dish. */
export const RECIPE_BASE_SERVINGS = 4;

export const generatedRecipeSchema = z.object({
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
Do not suggest a ready-made or semi-finished version of the dish. 3-12 steps.`;

export const dishKey = (dish: string) => normalizeKey(dish);
export const ingredientKey = (name: string, unit: MeasureUnit) => `ingredient:${normalizeKey(name)}:${unit}`;

export async function generateRecipe(dish: string, { llm, cache }: { llm: Llm; cache: Cache }): Promise<GeneratedRecipe | null> {
  return cache.getOrLoad(`recipe:${dishKey(dish)}`, cacheTtl.recipe, () => llm.json(generatedRecipeSchema, {
    instructions: RECIPE_INSTRUCTIONS,
    role: "smart",
    timeoutMs: 45_000,
    data: { dish },
  }), { shouldCache: (recipe) => recipe !== null });
}

type DishOp = { action: "add" | "remove"; dish: string };

/**
 * Applies dish requests to the actor's wishes and to recipe membership. A dish another member already
 * requested is shared: the actor joins that recipe instead of creating a duplicate.
 */
export function applyDishOps({
  party,
  plan,
  actorId,
  dishOps,
  createId = () => crypto.randomUUID(),
}: {
  party: Party;
  plan: PartyPlanDraft;
  actorId: string;
  dishOps: DishOp[];
  createId?: () => string;
}) {
  let members = party.members;
  let recipes = plan.recipes;
  const newDishes: string[] = [];
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
      if (existing) {
        if (!existing.assignedMemberIds.includes(actorId)) {
          recipes = recipes.map((recipe) => recipe === existing ? { ...recipe, assignedMemberIds: [...recipe.assignedMemberIds, actorId].sort() } : recipe);
        } else {
          notes.push(`Страва «${existing.title}» вже є у плані.`);
        }
      } else if (!newDishes.some((dish) => dishKey(dish) === key)) {
        newDishes.push(op.dish);
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
  return { party: { members }, plan: { ...plan, recipes }, newDishes, notes };
}

/** Members (sorted) who asked for a dish, by its normalized key. */
export function dishMembers(party: Party, key: string) {
  return party.members
    .filter((member) => member.wishes.some((wish) => wish.fulfillmentStrategy === "recipe" && dishKey(wish.text) === key))
    .map((member) => member.id)
    .sort();
}

export function recipeFromGenerated(dish: string, generated: GeneratedRecipe, assignedMemberIds: string[]): VerifiedRecipe {
  const ingredients = generated.ingredients.filter((ingredient) => !isPantryStaple(ingredient.name));
  const servings = Math.max(1, assignedMemberIds.length);
  return {
    title: generated.title,
    dishKey: dishKey(dish),
    source: "generated",
    sourceUrl: null,
    baseServings: RECIPE_BASE_SERVINGS,
    servings,
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

const recipeServings = (recipe: VerifiedRecipe) => Math.max(1, recipe.assignedMemberIds.length);

type AggregatedIngredient = { key: string; name: string; unit: MeasureUnit; amount: number; memberIds: string[] };

/** Sums the same ingredient across every recipe, scaled to how many members want each dish. */
export function aggregateIngredients(recipes: VerifiedRecipe[]): AggregatedIngredient[] {
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
export function syncIngredientRows(plan: PartyPlanDraft) {
  const excluded = new Set(plan.excludedIngredientKeys ?? []);
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
export function relinkRecipes(plan: PartyPlanDraft): PartyPlanDraft {
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

export function dinnerWishFulfillments(party: Party, plan: PartyPlanDraft): WishFulfillment[] {
  return party.members.flatMap((member) => member.wishes.flatMap((wish) => {
    if (wish.fulfillmentStrategy !== "recipe") return [];
    const recipe = plan.recipes.find((item) => (item.dishKey ?? dishKey(item.title)) === dishKey(wish.text) && item.assignedMemberIds.includes(member.id));
    if (!recipe) return [];
    return [{
      memberId: member.id,
      wishId: wish.id,
      requestedStrategy: "recipe" as const,
      resolvedStrategy: "recipe" as const,
      candidateProductIds: [],
      selectedProductIds: [],
      recipeTitle: recipe.title,
      fallbackReason: "explicit_cooking" as const,
    }];
  }));
}

/** Recipe card text. The web chat renders every "Рецепт «…»" block as a card (src/lib/chat/recipe-message.ts). */
export function formatRecipes(recipes: VerifiedRecipe[]) {
  return recipes.map((recipe) => {
    const ingredients = [
      ...recipe.ingredients.map((ingredient) => `• ${ingredient.name} — ${formatMeasure(ingredient.requiredAmount, ingredient.unit)}`),
      ...(recipe.missingIngredients ?? []).map((ingredient) => `• ${ingredient.name} — ${formatMeasure(ingredient.requiredAmount, ingredient.unit)} (не знайдено в Сільпо)`),
    ];
    const steps = recipe.steps.map((step, index) => `${index + 1}. ${step}`);
    const source = recipe.sourceUrl ? `\nДжерело: ${recipe.sourceUrl}` : "";
    return `Рецепт «${recipe.title}» (${recipe.servings} порц.):\nІнгредієнти:\n${ingredients.join("\n")}\nПриготування:\n${steps.join("\n")}${source}`;
  }).join("\n\n");
}
