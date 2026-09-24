import { z } from "zod";

import { cacheTtl, createNoopCache, normalizeKey, type Cache } from "../cache/index.ts";
import type { CatalogProduct } from "../domain/plan.ts";
import { productLineTotalUah } from "../domain/purchasing.ts";
import { purchaseQuantity, type RequestedAmount } from "../domain/quantity.ts";
import type { Llm } from "../llm/json.ts";
import type { CatalogSession, DetailsOutcome, SearchMatch, SearchOutcome } from "../silpo/catalog.ts";
import { unlimitedDeadline, type Deadline } from "./deadline.ts";

/** One thing to buy: a direct request, a recipe ingredient, or an event checklist line. */
export type ItemNeed = {
  /** Unique within one resolveItems call. */
  key: string;
  /** User-facing name used in replies. */
  label: string;
  /** Short catalog search term. */
  query: string;
  altQueries?: string[];
  requested?: RequestedAmount;
  assignedMemberIds: string[];
};

export type ResolvedItem = {
  need: ItemNeed;
  product: CatalogProduct;
  quantity: number;
  lineTotalUah: number;
  /** Other suitable in-stock candidates, cheapest first (used for budget trimming). */
  alternatives: CatalogProduct[];
  via: "learned" | "llm" | "top";
};

export type UnresolvedReason = "no_results" | "no_match" | "unavailable" | "no_details" | "mcp_error" | "timeout";

export type UnresolvedItem = { need: ItemNeed; reason: UnresolvedReason; suggestions: string[] };

export type ResolveResult = {
  resolved: ResolvedItem[];
  unresolved: UnresolvedItem[];
  /** Set when the Silpo delivery context (active cart, store, slot) could not be read at all. */
  contextError?: string;
};

type LearnedPick = { externalProductId: string; id: string; slug: string | null; companyId: string | null; name: string | null };

const CANDIDATES_PER_NEED = 4;
const MIN_LLM_BUDGET_MS = 6_000;
// Needs per selection call. One call for a whole event checklist (~16 needs, ~8k chars) outran its timeout,
// and a failed call used to leave every need to the raw top search hit; small parallel calls fail alone.
const PICK_BATCH_SIZE = 4;

const pickSchema = z.object({
  choices: z.array(z.object({
    key: z.string(),
    index: z.number().int().min(0).nullable(),
  })),
});

const PICK_INSTRUCTIONS = `For each shopping need, choose the catalog candidate that is genuinely the requested item.
Match the actual kind of product and its everyday use, not a shared word: "картопля" is raw potatoes, not potato chips; "апельсиновий сік" is orange juice, not an orange-flavoured soda; "желейки" are jelly candies.
Prefer the ordinary supermarket form, a sensible package for the requested amount, and a lower price when candidates are otherwise equivalent.
Return {"choices": [{"key": string, "index": number|null}]} with one entry per need; index refers to that need's candidates list. Use null only when no candidate is the requested item.`;

function learnedKey(branchId: string, query: string) {
  return `pick:${branchId}:${normalizeKey(query)}`;
}

function interleave(lists: SearchMatch[][], limit: number) {
  const picked: SearchMatch[] = [];
  const seen = new Set<string>();
  for (let index = 0; picked.length < limit && lists.some((list) => index < list.length); index += 1) {
    for (const list of lists) {
      const match = list[index];
      if (match && !seen.has(match.externalProductId)) {
        seen.add(match.externalProductId);
        picked.push(match);
        if (picked.length === limit) break;
      }
    }
  }
  return picked;
}

/**
 * Without a model decision, a search hit is only trusted when its name contains every query word (the last
 * letter of long words trimmed for inflection): the catalog search is fuzzy and ranks "шампунь" first for
 * "шампури", and "шампу" would still match it, so short words must match whole.
 */
export function namesQuery(product: Pick<CatalogProduct, "name">, query: string) {
  const name = normalizeKey(product.name);
  return normalizeKey(query).split(" ").filter((word) => word.length > 2)
    .every((word) => name.includes(word.length >= 7 ? word.slice(0, -1) : word));
}

function describeCandidate(product: CatalogProduct) {
  const size = product.weighted ? `ціна за ${product.unit}` : `${product.packageSize.amount} ${product.packageSize.unit}`;
  return { name: product.name, priceUah: product.priceUah, package: size };
}

function unresolvedReason(searches: Array<SearchOutcome | undefined>, candidates: SearchMatch[], details: Map<string, DetailsOutcome>): UnresolvedReason {
  if (!candidates.length) {
    return searches.length && searches.every((search) => !search || search.status === "error") ? "mcp_error" : "no_results";
  }
  const outcomes = candidates.map((candidate) => details.get(candidate.externalProductId));
  if (outcomes.some((outcome) => outcome?.status === "unavailable")) return "unavailable";
  if (outcomes.every((outcome) => !outcome || outcome.status === "error")) return "mcp_error";
  return "no_details";
}

/**
 * Resolves each need to one in-stock Silpo product and a purchase quantity. Needs are independent: a search
 * error, an empty result, or an unavailable product affects only its own need and is reported with a reason.
 */
export async function resolveItems(needs: ItemNeed[], {
  session,
  llm,
  cache = createNoopCache(),
  deadline = unlimitedDeadline,
}: {
  session: CatalogSession;
  llm: Llm | null;
  cache?: Cache;
  deadline?: Deadline;
}): Promise<ResolveResult> {
  const resolved: ResolvedItem[] = [];
  const unresolved: UnresolvedItem[] = [];
  if (!needs.length) return { resolved, unresolved };

  const quantityFor = (need: ItemNeed, product: CatalogProduct) => {
    const quantity = purchaseQuantity(need.requested ?? {}, product);
    return { quantity, lineTotalUah: productLineTotalUah(product, quantity) };
  };

  let branchId: string | null = null;
  try {
    branchId = (await session.context()).branchId;
  } catch (error) {
    console.warn("resolveItems: no Silpo delivery context", error);
    return {
      resolved,
      unresolved: needs.map((need) => ({ need, reason: "mcp_error", suggestions: [] })),
      contextError: error instanceof Error ? error.message : String(error),
    };
  }

  // 1. Needs we already matched recently skip search and model selection entirely.
  let pending: ItemNeed[] = [];
  const learned = new Map<string, LearnedPick>();
  for (const need of needs) {
    const pick = await cache.get<LearnedPick>(learnedKey(branchId, need.query));
    if (pick) learned.set(need.key, pick);
    else pending.push(need);
  }
  if (learned.size) {
    const learnedDetails = await session.details([...learned.values()].map((pick) => ({ ...pick, raw: {} })));
    for (const need of needs) {
      const pick = learned.get(need.key);
      if (!pick) continue;
      const outcome = learnedDetails.get(pick.externalProductId);
      if (outcome?.status === "ok") {
        resolved.push({ need, product: outcome.product, ...quantityFor(need, outcome.product), alternatives: [], via: "learned" });
      } else {
        await cache.delete([learnedKey(branchId, need.query)]);
        pending.push(need);
      }
    }
  }
  if (!pending.length) return { resolved, unresolved };

  if (deadline.expired()) {
    return { resolved, unresolved: [...unresolved, ...pending.map((need) => ({ need, reason: "timeout" as const, suggestions: [] }))] };
  }

  // 2. One batched search for every remaining query variant.
  const queriesFor = (need: ItemNeed) => [need.query, ...(need.altQueries ?? [])].filter((query) => query.trim());
  const searches = await session.search(pending.flatMap(queriesFor));
  const candidatesByNeed = new Map(pending.map((need) => [need.key, interleave(
    queriesFor(need).map((query) => searches.get(query)?.matches ?? []),
    CANDIDATES_PER_NEED,
  )]));

  if (deadline.expired()) {
    return { resolved, unresolved: [...unresolved, ...pending.map((need) => ({ need, reason: "timeout" as const, suggestions: [] }))] };
  }

  // 3. Live details for every candidate, in one bounded-concurrency pass.
  const details = await session.details([...candidatesByNeed.values()].flat());
  const viableByNeed = new Map<string, CatalogProduct[]>();
  const unavailable: Array<{ slug?: string | null }> = [];
  for (const need of pending) {
    const viable: CatalogProduct[] = [];
    for (const candidate of candidatesByNeed.get(need.key) ?? []) {
      const outcome = details.get(candidate.externalProductId);
      if (outcome?.status === "ok") viable.push(outcome.product);
      if (outcome?.status === "unavailable") unavailable.push({ slug: outcome.product.slug });
    }
    viableByNeed.set(need.key, viable);
  }
  if (unavailable.length) await session.forget(unavailable);

  const withoutCandidates = pending.filter((need) => !viableByNeed.get(need.key)?.length);
  for (const need of withoutCandidates) {
    const candidates = candidatesByNeed.get(need.key) ?? [];
    unresolved.push({
      need,
      reason: unresolvedReason(queriesFor(need).map((query) => searches.get(query)), candidates, details),
      suggestions: candidates.flatMap((candidate) => candidate.name ?? []).slice(0, 3),
    });
  }
  pending = pending.filter((need) => viableByNeed.get(need.key)?.length);

  // 4. The model chooses among candidates, in small parallel batches. Single candidates are checked too: a lone
  // search hit can still be the wrong kind of product.
  const choices = new Map<string, number | null>();
  let askedModel = false;
  if (llm && pending.length && deadline.remaining() > MIN_LLM_BUDGET_MS) {
    askedModel = true;
    const batches: ItemNeed[][] = [];
    for (let index = 0; index < pending.length; index += PICK_BATCH_SIZE) batches.push(pending.slice(index, index + PICK_BATCH_SIZE));
    const responses = await Promise.all(batches.map((batch) => llm.json(pickSchema, {
      instructions: PICK_INSTRUCTIONS,
      role: "fast",
      // Measured 4-14 s per batch on deepseek-flash, with outliers past 15 s; batches run side by side and the
      // turn deadline still caps each call.
      timeoutMs: 25_000,
      data: {
        needs: batch.map((need) => ({
          key: need.key,
          request: need.label,
          ...(need.requested?.amount ? { amount: need.requested.amount, unit: need.requested.unit } : {}),
          candidates: viableByNeed.get(need.key)!.map((product, index) => ({ index, ...describeCandidate(product) })),
        })),
      },
    })));
    responses.forEach((response, batchIndex) => {
      const keys = new Set(batches[batchIndex].map((need) => need.key));
      for (const choice of response?.choices ?? []) if (keys.has(choice.key)) choices.set(choice.key, choice.index);
    });
  }

  for (const need of pending) {
    const viable = viableByNeed.get(need.key)!;
    const suggestions = viable.map((product) => product.name).slice(0, 3);
    const choice = choices.get(need.key);
    if (choice === null) {
      unresolved.push({ need, reason: "no_match", suggestions });
      continue;
    }
    const chosen = typeof choice === "number" && choice < viable.length;
    const product = chosen ? viable[choice] : viable.find((candidate) => namesQuery(candidate, need.query));
    if (!product) {
      unresolved.push({ need, reason: askedModel ? "timeout" : "no_match", suggestions });
      continue;
    }
    resolved.push({
      need,
      product,
      ...quantityFor(need, product),
      alternatives: viable.filter((candidate) => candidate !== product).sort((left, right) => left.priceUah - right.priceUah),
      via: chosen ? "llm" : "top",
    });
    // Only a model-confirmed choice is remembered; a fallback guess must not be reused for a day.
    if (chosen) {
      await cache.set(learnedKey(branchId, need.query), {
        externalProductId: product.lookupProductId,
        id: product.id,
        slug: product.slug ?? null,
        companyId: product.companyId ?? null,
        name: product.name,
      } satisfies LearnedPick, cacheTtl.learnedPick);
    }
  }

  return {
    resolved: needs.flatMap((need) => resolved.filter((item) => item.need.key === need.key)),
    unresolved: needs.flatMap((need) => unresolved.filter((item) => item.need.key === need.key)),
  };
}
