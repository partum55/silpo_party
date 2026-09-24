import { z } from "zod";

import { cacheTtl, createNoopCache, normalizeKey, type Cache } from "../cache/index.ts";
import { CANDIDATES_PER_NEED, MIN_MODEL_BUDGET_MS, MODEL_TIMEOUT_MS, PICK_BATCH_SIZE } from "../config.ts";
import type { UnresolvedReason } from "../domain/contract.ts";
import type { CatalogProduct } from "../domain/plan.ts";
import { productLineTotalUah } from "../domain/purchasing.ts";
import { purchaseQuantity, type RequestedAmount } from "../domain/quantity.ts";
import { productRestrictionSafety, unverifiedRestrictions } from "../domain/restrictions.ts";
import type { Llm } from "../llm/llm.ts";
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
  /** Brand the user named: no other brand may be bought for this need. */
  brand?: string;
  requested?: RequestedAmount;
  assignedMemberIds: string[];
  /** Food restrictions of everyone who pays for this need. */
  restrictions?: string[];
};

export type ResolvedItem = {
  need: ItemNeed;
  product: CatalogProduct;
  quantity: number;
  lineTotalUah: number;
  /** Other suitable in-stock candidates, cheapest first (used for budget trimming). */
  alternatives: CatalogProduct[];
  /** Restrictions this product could not be confirmed safe for (Silpo lists no composition). */
  unverifiedRestrictions: string[];
  via: "learned" | "llm" | "top";
};

export type UnresolvedItem = { need: ItemNeed; reason: UnresolvedReason; suggestions: string[] };

export type ResolveResult = {
  resolved: ResolvedItem[];
  unresolved: UnresolvedItem[];
  /** Set when the Silpo delivery context (active cart, store, slot) could not be read at all. */
  contextError?: string;
};

type LearnedPick = { externalProductId: string; id: string; slug: string | null; companyId: string | null; name: string | null };

const pickSchema = z.object({
  choices: z.array(z.object({
    key: z.string(),
    index: z.number().int().min(0).nullable(),
  })),
});

const PICK_INSTRUCTIONS = `For each shopping need, choose the catalog candidate that is genuinely the requested item.
Match the actual kind of product and its everyday use, not a shared word: "картопля" is raw potatoes, not potato chips; "апельсиновий сік" is orange juice, not an orange-flavoured soda; "желейки" are jelly candies.
When the request names a specific product line, flavour, or size, choose only a candidate that matches it.
When a need has "mustBeBrand", choose only a candidate of that brand, whatever its spelling (Latin or Cyrillic); otherwise null.
Prefer the ordinary supermarket form, a sensible package for the requested amount, and a lower price when candidates are otherwise equivalent.
Return {"choices": [{"key": string, "index": number|null}]} with one entry per need; index refers to that need's candidates list. Use null only when no candidate is the requested item.`;

const learnedKey = (branchId: string, query: string) => `pick:${branchId}:${normalizeKey(query)}`;

/** Takes matches round-robin from each query's list, so every query variant is represented. */
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

const compact = (value: string) => normalizeKey(value).replace(/\s+/g, "");

/**
 * Whether a product name contains the brand, ignoring case, spaces, and punctuation ("Coca-Cola" ~ "COCA COLA").
 * A brand spelled in another script ("Кока-Кола") does not match; the product picker handles that case.
 */
export function hasBrand(name: string, brand: string) {
  return compact(name).includes(compact(brand));
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

/** Candidates the need's payers may eat: conflicts are dropped, and confirmed-safe products win over unknown ones. */
function safeCandidates(need: ItemNeed, products: CatalogProduct[]) {
  const restrictions = need.restrictions ?? [];
  if (!restrictions.length) return products;
  const allowed = products.filter((product) => productRestrictionSafety(product, restrictions) !== "unsafe");
  const safe = allowed.filter((product) => productRestrictionSafety(product, restrictions) === "safe");
  return safe.length ? safe : allowed;
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

  const resolve = (need: ItemNeed, product: CatalogProduct, via: ResolvedItem["via"], alternatives: CatalogProduct[] = []) => {
    const quantity = purchaseQuantity(need.requested ?? {}, product);
    resolved.push({
      need,
      product,
      quantity,
      lineTotalUah: productLineTotalUah(product, quantity),
      alternatives,
      unverifiedRestrictions: unverifiedRestrictions(product, need.restrictions ?? []),
      via,
    });
  };
  const timedOut = (pending: ItemNeed[]) => ({
    resolved,
    unresolved: [...unresolved, ...pending.map((need) => ({ need, reason: "timeout" as const, suggestions: [] }))],
  });

  let branchId: string;
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

  // 1. A product the model already chose for this query skips search and selection, if it is still in stock and
  // the payers may eat it.
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
      if (outcome?.status === "ok" && safeCandidates(need, [outcome.product]).length) {
        resolve(need, outcome.product, "learned");
        continue;
      }
      if (outcome?.status !== "ok") await cache.delete([learnedKey(branchId, need.query)]);
      pending.push(need);
    }
  }
  if (!pending.length) return { resolved, unresolved };
  if (deadline.expired()) return timedOut(pending);

  // 2. One batched search for every query variant. With a brand, the brand alone is searched too: the live
  // search returns nothing for some combined queries ("гель для душу Dove") that the brand alone matches.
  const queriesFor = (need: ItemNeed) => [...new Set([need.query, ...(need.altQueries ?? []), ...(need.brand ? [need.brand] : [])])]
    .filter((query) => query.trim());
  const searches = await session.search(pending.flatMap(queriesFor));
  const hitsFor = (need: ItemNeed) => queriesFor(need).map((query) => searches.get(query)?.matches ?? []);

  // A named brand filters the raw hits before the cut, so generic hits cannot crowd it out. When no name
  // contains the brand as written, the unfiltered hits go to the picker, which must enforce the brand.
  const pickerMustCheckBrand = new Set<string>();
  const candidatesByNeed = new Map(pending.map((need) => {
    const hits = hitsFor(need);
    if (need.brand) {
      const branded = hits.map((list) => list.filter((match) => hasBrand(match.name ?? "", need.brand!)));
      if (branded.some((list) => list.length)) return [need.key, interleave(branded, CANDIDATES_PER_NEED)] as const;
      pickerMustCheckBrand.add(need.key);
    }
    return [need.key, interleave(hits, CANDIDATES_PER_NEED)] as const;
  }));
  if (deadline.expired()) return timedOut(pending);

  // 3. Live details for every candidate, then the payers' restrictions.
  const details = await session.details([...candidatesByNeed.values()].flat());
  const viableByNeed = new Map<string, CatalogProduct[]>();
  const unavailable: Array<{ slug?: string | null }> = [];
  for (const need of pending) {
    const inStock: CatalogProduct[] = [];
    for (const candidate of candidatesByNeed.get(need.key) ?? []) {
      const outcome = details.get(candidate.externalProductId);
      if (outcome?.status === "ok") inStock.push(outcome.product);
      if (outcome?.status === "unavailable") unavailable.push({ slug: outcome.product.slug });
    }
    const allowed = safeCandidates(need, inStock);
    if (inStock.length && !allowed.length) {
      unresolved.push({ need, reason: "restricted", suggestions: [] });
      continue;
    }
    viableByNeed.set(need.key, allowed);
  }
  if (unavailable.length) await session.forget(unavailable);

  for (const need of pending) {
    const viable = viableByNeed.get(need.key);
    if (!viable || viable.length) continue;
    const candidates = candidatesByNeed.get(need.key) ?? [];
    unresolved.push({
      need,
      reason: unresolvedReason(queriesFor(need).map((query) => searches.get(query)), candidates, details),
      suggestions: candidates.flatMap((candidate) => candidate.name ?? []).slice(0, 3),
    });
  }
  pending = pending.filter((need) => viableByNeed.get(need.key)?.length);

  // 4. The model chooses among candidates in small parallel batches. Single candidates are checked too: a lone
  // search hit can still be the wrong kind of product.
  const choices = new Map<string, number | null>();
  let askedModel = false;
  if (llm && pending.length && deadline.remaining() > MIN_MODEL_BUDGET_MS) {
    askedModel = true;
    const batches: ItemNeed[][] = [];
    for (let index = 0; index < pending.length; index += PICK_BATCH_SIZE) batches.push(pending.slice(index, index + PICK_BATCH_SIZE));
    const responses = await Promise.all(batches.map((batch) => llm.json(pickSchema, {
      instructions: PICK_INSTRUCTIONS,
      role: "fast",
      timeoutMs: MODEL_TIMEOUT_MS.pick,
      data: {
        needs: batch.map((need) => ({
          key: need.key,
          request: need.label,
          ...(need.requested?.amount ? { amount: need.requested.amount, unit: need.requested.unit } : {}),
          ...(pickerMustCheckBrand.has(need.key) ? { mustBeBrand: need.brand } : {}),
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
    const brandUnconfirmed = pickerMustCheckBrand.has(need.key);
    const choice = choices.get(need.key);
    if (choice === null) {
      unresolved.push({ need, reason: brandUnconfirmed ? "no_brand" : "no_match", suggestions });
      continue;
    }
    const chosen = typeof choice === "number" && choice < viable.length;
    // Without a model decision, never guess a brand; otherwise take the first hit that names the request.
    const product = chosen ? viable[choice] : brandUnconfirmed ? undefined : viable.find((candidate) => namesQuery(candidate, need.query));
    if (!product) {
      unresolved.push({ need, reason: brandUnconfirmed ? "no_brand" : askedModel ? "timeout" : "no_match", suggestions });
      continue;
    }
    resolve(need, product, chosen ? "llm" : "top", viable.filter((candidate) => candidate !== product).sort((left, right) => left.priceUah - right.priceUah));
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
