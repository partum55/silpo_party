import type { VerifiedProduct } from "../domain/plan.ts";
import { formatPurchase } from "../domain/quantity.ts";
import type { PlanChange } from "./plan-builder.ts";
import type { UnresolvedItem } from "./resolve-items.ts";

const money = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatUah(value: number) {
  return `${money.format(value)} грн`;
}

const quoted = (value: string) => `«${value}»`;

function unresolvedLine({ need, reason, suggestions }: UnresolvedItem) {
  const similar = suggestions.length ? ` Схожі: ${suggestions.map(quoted).join(", ")}.` : "";
  switch (reason) {
    case "no_results": return `${quoted(need.label)} — у Сільпо нічого не знайдено.`;
    case "no_brand": return `${quoted(need.label)} — у Сільпо не знайшов такого товару ${need.brand ?? "цього бренду"}.${similar}`;
    case "no_match": return `${quoted(need.label)} — не знайшов саме цього товару.${similar}`;
    case "unavailable": return `${quoted(need.label)} — зараз немає в наявності.${similar}`;
    case "timeout": return `${quoted(need.label)} — не встиг обробити, повторіть запит.`;
    case "no_details":
    case "mcp_error": return `${quoted(need.label)} — Сільпо не відповів, спробуйте ще раз.`;
  }
}

export type TurnReport = {
  added?: PlanChange[];
  removed?: VerifiedProduct[];
  quantityChanged?: VerifiedProduct[];
  unresolved?: UnresolvedItem[];
  notFoundInPlan?: string[];
  notes?: string[];
  totalUah?: number | null;
};

const section = (title: string, lines: string[]) => `${title}\n${lines.map((line) => `• ${line}`).join("\n")}`;

/**
 * One reply that tells the group exactly what changed and, per item, why anything was not added. One item per
 * line: the chat bubble renders with whitespace-pre-wrap, so this reads as a list without client-side parsing.
 */
export function buildResponseText(report: TurnReport) {
  const parts: string[] = [];
  const added = report.added ?? [];
  if (added.length) {
    parts.push(section("Додано:", added.map(({ product, addedQuantity }) => `${quoted(product.name)} ${formatPurchase(product, addedQuantity)}`)));
  }
  if (report.quantityChanged?.length) {
    parts.push(section("Змінено кількість:", report.quantityChanged.map((product) => `${quoted(product.name)} ${formatPurchase(product, product.quantity)}`)));
  }
  if (report.removed?.length) {
    parts.push(section("Прибрано:", [...new Set(report.removed.map((product) => product.name))].map(quoted)));
  }
  if (report.notFoundInPlan?.length) {
    parts.push(section("У плані немає:", report.notFoundInPlan.map(quoted)));
  }
  if (report.unresolved?.length) {
    parts.push(section("Не додано:", report.unresolved.map(unresolvedLine)));
  }
  parts.push(...(report.notes ?? []));
  if (!parts.length) parts.push("План не змінено.");
  if (typeof report.totalUah === "number" && (added.length || report.removed?.length || report.quantityChanged?.length)) {
    parts.push(`Разом у кошику: ${formatUah(report.totalUah)}.`);
  }
  return parts.join("\n\n");
}
