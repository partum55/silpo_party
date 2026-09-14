import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { foundRecipeSchema } from "../../domain/schemas.ts";

type Json = Record<string, unknown>;

const unitFactors: Record<string, { unit: "g" | "ml" | "piece"; factor: number }> = {
  g: { unit: "g", factor: 1 }, gram: { unit: "g", factor: 1 }, grams: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 }, oz: { unit: "g", factor: 28.3495 }, ounce: { unit: "g", factor: 28.3495 }, ounces: { unit: "g", factor: 28.3495 },
  lb: { unit: "g", factor: 453.592 }, lbs: { unit: "g", factor: 453.592 }, pound: { unit: "g", factor: 453.592 }, pounds: { unit: "g", factor: 453.592 },
  ml: { unit: "ml", factor: 1 }, l: { unit: "ml", factor: 1000 }, cup: { unit: "ml", factor: 240 }, cups: { unit: "ml", factor: 240 },
  tbsp: { unit: "ml", factor: 15 }, tablespoon: { unit: "ml", factor: 15 }, tablespoons: { unit: "ml", factor: 15 },
  tsp: { unit: "ml", factor: 5 }, teaspoon: { unit: "ml", factor: 5 }, teaspoons: { unit: "ml", factor: 5 },
  piece: { unit: "piece", factor: 1 }, pieces: { unit: "piece", factor: 1 }, item: { unit: "piece", factor: 1 }, items: { unit: "piece", factor: 1 },
};

function amount(value: string) {
  const fractions: Record<string, string> = { "¼": " 1/4", "½": " 1/2", "¾": " 3/4", "⅓": " 1/3", "⅔": " 2/3" };
  const normalized = value.replace(/[¼½¾⅓⅔]/g, (part) => fractions[part]).trim();
  return normalized.split(/\s+/).reduce((sum, part) => {
    const [top, bottom] = part.split("/").map(Number);
    return sum + (bottom ? top / bottom : top);
  }, 0);
}

export function normalizeRecipeIngredient(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|\d*[¼½¾⅓⅔])\s+(.+)$/);
  if (!match) return null;
  const parsedAmount = amount(match[1]);
  const [rawUnit, ...rest] = match[2].trim().split(/\s+/);
  const knownUnit = unitFactors[rawUnit.toLowerCase()];
  const mapped = knownUnit ?? { unit: "piece" as const, factor: 1 };
  if (!parsedAmount) return null;
  const name = knownUnit ? rest.join(" ") : match[2];
  if (!name) return null;
  return { name: name.trim(), amount: Math.round(parsedAmount * mapped.factor * 1000) / 1000, unit: mapped.unit };
}

function recipeNode(value: unknown): Json | null {
  if (Array.isArray(value)) {
    for (const item of value) { const found = recipeNode(item); if (found) return found; }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const object = value as Json;
  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  if (types.includes("Recipe")) return object;
  for (const child of Object.values(object)) { const found = recipeNode(child); if (found) return found; }
  return null;
}

function steps(value: unknown): string[] {
  if (typeof value === "string") return value.split(/\r?\n/).map((step) => step.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(steps);
  if (value && typeof value === "object") return steps((value as Json).text ?? (value as Json).itemListElement);
  return [];
}

export function normalizeWebRecipe(value: unknown, sourceUrl: string) {
  const recipe = recipeNode(value);
  if (!recipe) return null;
  const servings = Number(String(recipe.recipeYield ?? "").match(/\d+/)?.[0]);
  const ingredients = Array.isArray(recipe.recipeIngredient)
    ? recipe.recipeIngredient.map((item) => typeof item === "string" ? normalizeRecipeIngredient(item) : null)
    : [];
  const result = {
    title: typeof recipe.name === "string" ? recipe.name : "",
    source: "web" as const,
    sourceUrl,
    servings,
    ingredients,
    steps: steps(recipe.recipeInstructions),
  };
  if (!ingredients.every(Boolean)) return null;
  const parsed = foundRecipeSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

export async function findRecipe(query: string) {
  try {
    const response = await fetch("https://api.sampleapis.com/recipes/recipes", { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const words = query.toLocaleLowerCase().split(/\s+/).filter((word) => word.length > 2);
    const recipes = (await response.json() as Array<{
      title?: string;
      source?: string;
      servings?: number;
      ingredients?: string;
      directions?: string;
    }>).map((recipe) => ({
      recipe,
      score: words.filter((word) => recipe.title?.toLocaleLowerCase().includes(word)).length,
    })).filter(({ score }) => score > 0).sort((left, right) => right.score - left.score);

    for (const { recipe } of recipes) {
      if (!recipe.source?.startsWith("http")) continue;
      const normalized = normalizeWebRecipe({
        "@type": "Recipe",
        name: recipe.title,
        recipeYield: recipe.servings,
        recipeIngredient: recipe.ingredients?.split(/\r?\n/).filter(Boolean),
        recipeInstructions: recipe.directions?.split(/\r?\n/).filter(Boolean),
      }, recipe.source);
      if (normalized) return normalized;
    }
    return null;
  } catch {
    return null;
  }
}

export const findRecipeTool = createTool({
  id: "find_recipe",
  description: "Find a real sourced recipe with servings, normalized ingredients, and preparation steps. Returns null when no verifiable recipe can be resolved.",
  inputSchema: z.object({ query: z.string().min(1) }),
  outputSchema: z.object({ recipe: foundRecipeSchema.nullable() }),
  execute: async ({ query }) => ({ recipe: await findRecipe(query) }),
});
