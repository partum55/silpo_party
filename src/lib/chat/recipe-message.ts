export type ParsedRecipeMessage = {
  prefix: string;
  title: string;
  servings: string;
  ingredients: string[];
  steps: string[];
  source: string | null;
};

export function parseRecipeMessage(content: string): ParsedRecipeMessage | null {
  const start = content.indexOf("Рецепт «");
  if (start < 0) return null;
  const prefix = content.slice(0, start).trim();
  const recipe = content.slice(start);
  const header = recipe.match(/^Рецепт «([^»]+)» \(([^)]+)\):\s*Інгредієнти:\s*/);
  if (!header) return null;
  const body = recipe.slice(header[0].length);
  const preparationMarker = body.search(/\s*Приготування:\s*/);
  if (preparationMarker < 0) return null;
  const ingredientText = body.slice(0, preparationMarker).trim();
  let preparationText = body.slice(preparationMarker).replace(/^\s*Приготування:\s*/, "").trim();
  const sourceMatch = preparationText.match(/\s+Джерело:\s*(https?:\/\/\S+)\s*$/);
  const source = sourceMatch?.[1] ?? null;
  if (sourceMatch) preparationText = preparationText.slice(0, sourceMatch.index).trim();
  const ingredients = ingredientText.split(/\s*•\s*/).map((item) => item.trim()).filter(Boolean);
  const steps = preparationText.split(/\s+(?=\d+\.\s)/).map((item) => item.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
  if (!ingredients.length || !steps.length) return null;
  return { prefix, title: header[1], servings: header[2], ingredients, steps, source };
}

/** Parses an agent reply that may contain several recipes (one per dish added in the same message). */
export function parseRecipeMessages(content: string): { prefix: string; recipes: ParsedRecipeMessage[] } | null {
  const start = content.indexOf("Рецепт «");
  if (start < 0) return null;
  const blocks = content.slice(start).split(/\n\s*\n(?=Рецепт «)/);
  const recipes = blocks.map((block) => parseRecipeMessage(block.trim()));
  if (!recipes.length || recipes.some((recipe) => !recipe)) return null;
  return { prefix: content.slice(0, start).trim(), recipes: recipes as ParsedRecipeMessage[] };
}
