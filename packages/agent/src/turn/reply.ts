import type { TurnReply, TurnReport, UnresolvedLine } from "../domain/contract.ts";
import type { VerifiedRecipe } from "../domain/plan.ts";
import { formatMeasure, formatPurchase } from "../domain/quantity.ts";

const money = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatUah(value: number) {
  return `${money.format(value)} грн`;
}

const quoted = (value: string) => `«${value}»`;

function unresolvedLine({ label, brand, restrictions, reason, suggestions }: UnresolvedLine) {
  const similar = suggestions.length ? ` Схожі: ${suggestions.map(quoted).join(", ")}.` : "";
  switch (reason) {
    case "no_results": return `${quoted(label)} — у Сільпо нічого не знайдено.`;
    case "restricted": return `${quoted(label)} — не знайшов варіанта без: ${(restrictions ?? []).join(", ")}.`;
    case "no_brand": return `${quoted(label)} — у Сільпо не знайшов такого товару ${brand ?? "цього бренду"}.${similar}`;
    case "no_match": return `${quoted(label)} — не знайшов саме цього товару.${similar}`;
    case "unavailable": return `${quoted(label)} — зараз немає в наявності.${similar}`;
    case "timeout": return `${quoted(label)} — не встиг обробити, повторіть запит.`;
    case "no_details":
    case "mcp_error": return `${quoted(label)} — Сільпо не відповів, спробуйте ще раз.`;
  }
}

const section = (title: string, lines: string[]) => `${title}\n${lines.map((line) => `• ${line}`).join("\n")}`;

/** Recipe card text. The web chat renders every "Рецепт «…»" block as a card (src/lib/chat/recipe-message.ts). */
function formatRecipe(recipe: VerifiedRecipe) {
  const ingredients = [
    ...recipe.ingredients.map((ingredient) => `• ${ingredient.name} — ${formatMeasure(ingredient.requiredAmount, ingredient.unit)}`),
    ...(recipe.missingIngredients ?? []).map((ingredient) => `• ${ingredient.name} — ${formatMeasure(ingredient.requiredAmount, ingredient.unit)} (не знайдено в Сільпо)`),
  ];
  const steps = recipe.steps.map((step, index) => `${index + 1}. ${step}`);
  const source = recipe.sourceUrl ? `\nДжерело: ${recipe.sourceUrl}` : "";
  return `Рецепт «${recipe.title}» (${recipe.servings} порц.):\nІнгредієнти:\n${ingredients.join("\n")}\nПриготування:\n${steps.join("\n")}${source}`;
}

function formatReport(report: TurnReport, totalUah: number) {
  const parts: string[] = [];
  if (report.added.length) {
    parts.push(section("Додано:", report.added.map(({ product, addedQuantity }) => `${quoted(product.name)} ${formatPurchase(product, addedQuantity)}`)));
  }
  if (report.quantityChanged.length) {
    parts.push(section("Змінено кількість:", report.quantityChanged.map((product) => `${quoted(product.name)} ${formatPurchase(product, product.quantity)}`)));
  }
  if (report.removed.length) {
    parts.push(section("Прибрано:", [...new Set(report.removed.map((product) => product.name))].map(quoted)));
  }
  if (report.notFoundInPlan.length) parts.push(section("У плані немає:", report.notFoundInPlan.map(quoted)));
  if (report.unresolved.length) parts.push(section("Не додано:", report.unresolved.map(unresolvedLine)));
  if (report.unverified.length) {
    parts.push(section(
      "Перевірте склад (у Сільпо немає даних про нього):",
      report.unverified.map(({ product, restrictions }) => `${quoted(product)} — ${restrictions.join(", ")}`),
    ));
  }
  parts.push(...report.notes);
  if (!parts.length) parts.push("План не змінено.");
  if (report.added.length || report.removed.length || report.quantityChanged.length) {
    parts.push(`Разом у кошику: ${formatUah(totalUah)}.`);
  }
  parts.push(...report.recipes.map(formatRecipe));
  return parts.join("\n\n");
}

/**
 * The chat reply for a turn. `totalUah` is the plan total after the turn was saved, which can differ from the
 * turn's own plan when other members' turns were merged in concurrently.
 */
export function formatReply(reply: TurnReply, totalUah: number) {
  return reply.kind === "message" ? reply.text : formatReport(reply.report, totalUah);
}
