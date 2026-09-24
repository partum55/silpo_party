import { normalizeKey } from "../cache/index.ts";
import type { PlanningMode, TurnReport } from "../domain/contract.ts";
import type { PartyPlan, VerifiedProduct } from "../domain/plan.ts";
import type { ProductOp } from "../scenarios/router.ts";
import { findPlanProducts, removeRows, setRowQuantity } from "./plan-builder.ts";
import { hasBrand, type ItemNeed } from "./resolve-items.ts";

/** A need this turn will search for, with what its plan row should record. */
export type PlannedNeed = ItemNeed & { requestKey: string; reason: string; priority?: "essential" | "extra" };

export function productNeed(op: ProductOp, index: number, assignedMemberIds: string[], reason: string, requestKey?: string): PlannedNeed {
  // The brand must be in the search query, even when the model left it out ("вода мінеральна" + "Моршинська").
  const query = op.brand && !hasBrand(op.query, op.brand) ? `${op.query} ${op.brand}` : op.query;
  return {
    key: `op:${index}`,
    label: op.label,
    query,
    altQueries: op.altQueries,
    ...(op.brand ? { brand: op.brand } : {}),
    requested: { count: op.count, amount: op.amount, unit: op.unit },
    assignedMemberIds,
    requestKey: requestKey ?? `item:${normalizeKey(op.query)}`,
    reason,
  };
}

/** Rows a message refers to; in shopping mode a member's own rows win over someone else's. */
function targetRows(plan: PartyPlan, op: ProductOp, mode: PlanningMode, actorId: string) {
  const rows = findPlanProducts(plan, op.target ?? op.query);
  if (mode !== "SHOPPING") return rows;
  const own = rows.filter((row) => row.assignedMemberIds.includes(actorId));
  return own.length ? own : rows;
}

/**
 * Applies the product operations of a message: removals and quantity changes edit the plan directly, while
 * additions and replacements become needs to search for. Removed rows of a replacement are returned by the
 * key of the need that buys their replacement, so they can be restored if nothing new is found.
 */
export function applyProductOps(plan: PartyPlan, ops: ProductOp[], {
  mode,
  actorId,
  addAssignees,
  report,
}: {
  mode: PlanningMode;
  actorId: string;
  /** Who pays for added products: the requester, or everyone in event mode. */
  addAssignees: string[];
  report: TurnReport;
}) {
  const needs: PlannedNeed[] = [];
  const replaced = new Map<string, VerifiedProduct[]>();
  const directReason = mode === "EVENT" ? "Спільна покупка для події." : "Запит учасника.";

  ops.forEach((op, index) => {
    if (op.action === "add") {
      needs.push(productNeed(op, index, addAssignees, directReason));
      return;
    }
    const rows = targetRows(plan, op, mode, actorId);
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
      // A replacement keeps the need (and its recipe link) but buys a different product for the same people.
      plan = removeRows(plan, rows, { exclude: false });
      report.removed.push(...rows);
      replaced.set(`op:${index}`, rows);
      const assignees = [...new Set(rows.flatMap((row) => row.assignedMemberIds))];
      const requestKey = rows.find((row) => row.requestKey)?.requestKey;
      needs.push(productNeed(op, index, assignees, rows[0].reason, requestKey));
    }
  });

  return { plan, needs, replaced };
}
