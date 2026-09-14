import type {
  Blocker,
  FoundRecipe,
  PartyPlanningInput,
  PlannerProposal,
  Warning,
} from "./schemas.ts";

export const coverageTargets = {
  foodGramsPerPerson: 400,
  drinkMillilitersPerPerson: 750,
} as const;

type ProductMetadata = {
  ingredients: string[];
  allergens: string[];
  labels: string[];
  composition?: string[];
};

export type HydratedProduct = {
  id: string;
  name: string;
  priceUah: number;
  unit: string;
  available: boolean;
  weighted?: boolean;
  category: "food" | "drink";
  packageSize: { amount: number; unit: "g" | "ml" | "piece" };
  metadata: ProductMetadata;
  /** Silpo's per-listing company id, required to write this product into a real Silpo cart. */
  companyId?: string;
};

export type VerifiedProduct = HydratedProduct & {
  lookupProductId?: string;
  quantity: number;
  assignedMemberIds: string[];
  reason: string;
  lineTotalUah: number;
};

export type PartyPlanDraft = {
  summary: string;
  products: VerifiedProduct[];
  recipes: VerifiedRecipe[];
  totalUah: number;
  coverage: Record<string, { foodGrams: number; drinkMilliliters: number }>;
  wishFulfillments: WishFulfillment[];
};

export type WishFulfillment = {
  memberId: string;
  wishId: string;
  requestedStrategy: "ready_made" | "recipe" | "either";
  resolvedStrategy: "ready_made" | "recipe";
  candidateProductIds: string[];
  selectedProductIds: string[];
  recipeTitle: string | null;
  fallbackReason: "explicit_cooking" | "no_candidates" | "no_safe_candidate" | "poor_match" | null;
};

export type VerifiedRecipe = {
  title: string;
  source: "web" | "generated";
  sourceUrl: string | null;
  baseServings: number;
  servings: number;
  assignedMemberIds: string[];
  ingredients: Array<{
    name: string;
    baseAmount: number;
    requiredAmount: number;
    unit: "g" | "ml" | "piece";
    purchaseQuantity: number;
    purchasedAmount: number;
    selectedProduct: VerifiedProduct;
  }>;
  steps: string[];
};

type RestrictionResult = "safe" | "unsafe" | "unknown";

const normalize = (values: string[]) => values.join(" ").toLocaleLowerCase("uk");

const vegetarianAnimal = /chicken|beef|pork|turkey|duck|meat|fish|salmon|tuna|shrimp|seafood|gelatin|lard|курк|ялович|свинин|індич|качк|м['’]?яс|риб|лосос|тунц|кревет|морепродукт|желатин|смалец|бекон|шинка|ковбас|сосиск|анчоус|ікра/;
const wholePlant = /tomato|potato|cucumber|carrot|cabbage|pepper|onion|garlic|apple|banana|grape|orange|pear|berry|fruit|vegetable|almond|peanut|hazelnut|cashew|pistachio|nut|томат|помідор|картоп|огір|моркв|капуст|перець|цибул|часник|яблук|банан|виноград|апельс|мандарин|груш|ягод|фрукт|овоч|мигдал|арахіс|фундук|кеш['’]?ю|фісташ|горіх/;
const processedFood = /закуск|салат|соус|піца|сендвіч|бургер|торт|печив|цукерк|десерт|йогурт|чипс|паста|марин|консерв|напівфабрикат|snack|salad|sauce|pizza|sandwich|burger|cake|cookie|candy|dessert|yogurt|chips|flavou?r/;
const leafyProduce = /листов|зелень|рукол|шпинат|leafy|greens|arugula|spinach/;

function restrictionSafety(product: HydratedProduct, restriction: string): RestrictionResult {
  const value = restriction.toLocaleLowerCase("uk");
  const ingredients = normalize([
    ...product.metadata.ingredients,
    ...(product.metadata.composition ?? []),
  ]);
  const name = product.name.toLocaleLowerCase("uk");
  const labels = normalize(product.metadata.labels);
  const allergens = normalize(product.metadata.allergens);

  if (value.includes("vegetarian") || value.includes("вегетар")) {
    if (vegetarianAnimal.test(`${ingredients} ${allergens}`)) return "unsafe";
    if (/vegetarian|vegan|вегетар|веган/.test(`${name} ${labels}`)) return "safe";
    if (vegetarianAnimal.test(name)) return "unsafe";
    if (ingredients) return "safe";
    if (product.category === "drink" && /(^|\s)(water|вода|juice|сік|нектар)(\s|$)/.test(name)) return "safe";
    if (product.category === "drink" && /(напій|drink)/.test(name) && wholePlant.test(name)) return "safe";
    if (product.category === "food" && leafyProduce.test(name)) return "safe";
    if (product.category === "food" && wholePlant.test(name) && !processedFood.test(name)) return "safe";
    return "unknown";
  }

  if (value.includes("vegan") || value.includes("веган")) {
    if (labels.match(/vegan|веган/)) return "safe";
    if (!ingredients) return "unknown";
    return ingredients.match(/milk|cream|cheese|egg|honey|meat|fish|молок|вершк|сир|яйц|мед|м['’]?яс|риб/)
      ? "unsafe"
      : "safe";
  }

  if (value.match(/nut|горіх|арахіс/)) {
    if (labels.match(/nut[- ]?free|без горіх|без арахіс/)) return "safe";
    if (ingredients.match(/nut|peanut|almond|hazelnut|горіх|арахіс|мигдал|фундук/) || allergens.match(/nut|peanut|горіх|арахіс/)) return "unsafe";
    return "unknown";
  }

  if (value.match(/gluten|глютен/)) {
    if (labels.match(/gluten[- ]?free|без глютен/)) return "safe";
    if (ingredients.match(/wheat|barley|rye|пшениц|ячмін|жито/) || allergens.match(/gluten|глютен/)) return "unsafe";
    return "unknown";
  }

  if (value.match(/lactose|лактоз/)) {
    if (labels.match(/lactose[- ]?free|без лактоз/)) return "safe";
    if (ingredients.match(/milk|cream|молок|вершк/) || allergens.match(/milk|молок/)) return "unsafe";
    return "unknown";
  }

  return "unknown";
}

export async function validateProposal({
  input,
  budgetUah,
  partyWideRestrictions,
  proposal,
  hydrate,
  resolveRecipe,
  wishCandidates = [],
  targets = coverageTargets,
}: {
  input: PartyPlanningInput;
  budgetUah: number | null;
  partyWideRestrictions: string[];
  proposal: PlannerProposal;
  hydrate: (productId: string) => Promise<HydratedProduct | null>;
  resolveRecipe?: (query: string) => Promise<FoundRecipe | null>;
  wishCandidates?: Array<{
    memberId: string;
    wishId: string;
    requestedStrategy: "ready_made" | "recipe" | "either";
    candidates: Array<{ lookupProductId: string; product: HydratedProduct }>;
  }>;
  targets?: { foodGramsPerPerson: number; drinkMillilitersPerPerson: number };
}) {
  const members = new Map(input.currentParty.members.map((member) => [member.id, member]));
  const coverage = Object.fromEntries(
    input.currentParty.members.map((member) => [member.id, { foodGrams: 0, drinkMilliliters: 0 }]),
  );
  const blockers: Blocker[] = [];
  const selectedProducts: VerifiedProduct[] = [];
  const recipes: VerifiedRecipe[] = [];
  const verifiedSelections = new Map<string, VerifiedProduct>();

  for (const selection of proposal.selections) {
    const product = await hydrate(selection.productId);
    if (!product) {
      blockers.push({ code: "product_not_found", message: `Silpo product ${selection.productId} was not found.`, productId: selection.productId });
      continue;
    }
    if (!product.available) {
      blockers.push({ code: "product_unavailable", message: `${product.name} is unavailable.`, productId: product.id });
      continue;
    }
    const assignedIds = [...new Set(selection.assignedMemberIds)];
    const unknownIds = assignedIds.filter((id) => !members.has(id));
    if (unknownIds.length) {
      blockers.push({ code: "invalid_assignment", message: `${product.name} is assigned to unknown party members.`, productId: product.id });
      continue;
    }

    const safeIds: string[] = [];
    for (const memberId of assignedIds) {
      const member = members.get(memberId)!;
      const restrictions = [...new Set([...partyWideRestrictions, ...(member.restrictions ?? [])])];
      const results = restrictions.map((restriction) => restrictionSafety(product, restriction));
      if (results.includes("unsafe")) {
        blockers.push({ code: "restriction_violation", message: `${product.name} is unsafe for ${member.name ?? member.id}.`, productId: product.id, memberId });
      } else if (results.includes("unknown")) {
        blockers.push({ code: "restriction_unverified", message: `${product.name} cannot be verified for ${member.name ?? member.id}.`, productId: product.id, memberId });
      } else {
        safeIds.push(memberId);
      }
    }

    const totalAmount = product.packageSize.amount * selection.quantity;
    const amountPerMember = totalAmount / assignedIds.length;
    for (const memberId of safeIds) {
      if (product.category === "food" && product.packageSize.unit === "g") {
        coverage[memberId].foodGrams += amountPerMember;
      } else if (product.category === "drink" && product.packageSize.unit === "ml") {
        coverage[memberId].drinkMilliliters += amountPerMember;
      }
    }

    const verified = {
      ...product,
      lookupProductId: selection.productId,
      quantity: selection.quantity,
      assignedMemberIds: assignedIds,
      reason: `Assigned to ${assignedIds.length} participant${assignedIds.length === 1 ? "" : "s"}.`,
      lineTotalUah: Math.round(product.priceUah * selection.quantity * 100) / 100,
    };
    selectedProducts.push(verified);
    verifiedSelections.set(selection.productId, verified);
  }

  for (const proposedRecipe of proposal.recipes ?? []) {
    let recipe = proposedRecipe;
    if (proposedRecipe.source === "web") {
      const sourced = await resolveRecipe?.(proposedRecipe.title);
      if (!sourced) {
        blockers.push({ code: "recipe_unresolved", message: `${proposedRecipe.title} could not be resolved from a real recipe source.` });
        continue;
      }
      const productIds = new Map(proposedRecipe.ingredients.map((ingredient) => [ingredient.name.trim().toLocaleLowerCase(), ingredient.productId]));
      if (sourced.ingredients.some((ingredient) => !productIds.has(ingredient.name.trim().toLocaleLowerCase()))) {
        blockers.push({ code: "recipe_ingredient_mapping_missing", message: `${sourced.title} does not map every sourced ingredient to a Silpo product.` });
        continue;
      }
      recipe = {
        ...sourced,
        assignedMemberIds: proposedRecipe.assignedMemberIds,
        ingredients: sourced.ingredients.map((ingredient) => ({
          ...ingredient,
          productId: productIds.get(ingredient.name.trim().toLocaleLowerCase())!,
        })),
      };
    }

    const assignedIds = [...new Set(recipe.assignedMemberIds)];
    const unknownIds = assignedIds.filter((id) => !members.has(id));
    if (unknownIds.length) {
      blockers.push({ code: "invalid_assignment", message: `${recipe.title} is assigned to unknown party members.` });
      continue;
    }
    let fullyResolved = true;
    const safeIds = new Set(assignedIds);
    const ingredients: VerifiedRecipe["ingredients"] = [];
    const scale = assignedIds.length / recipe.servings;

    for (const ingredient of recipe.ingredients) {
      const product = await hydrate(ingredient.productId);
      if (!product) {
        blockers.push({ code: "product_not_found", message: `Silpo product ${ingredient.productId} for ${ingredient.name} was not found.`, productId: ingredient.productId });
        fullyResolved = false;
        continue;
      }
      if (!product.available) {
        blockers.push({ code: "product_unavailable", message: `${product.name} for ${ingredient.name} is unavailable.`, productId: product.id });
        fullyResolved = false;
        continue;
      }
      if (product.packageSize.unit !== ingredient.unit) {
        blockers.push({ code: "recipe_unit_mismatch", message: `${ingredient.name} requires ${ingredient.unit}, but ${product.name} is sold in ${product.packageSize.unit}.`, productId: product.id });
        fullyResolved = false;
        continue;
      }

      const evidenceProduct: HydratedProduct = {
        ...product,
        metadata: {
          ...product.metadata,
          composition: [...(product.metadata.composition ?? []), ingredient.name],
        },
      };
      for (const memberId of assignedIds) {
        const member = members.get(memberId)!;
        const restrictions = [...new Set([...partyWideRestrictions, ...(member.restrictions ?? [])])];
        const results = restrictions.map((restriction) => restrictionSafety(evidenceProduct, restriction));
        if (results.includes("unsafe")) {
          blockers.push({ code: "restriction_violation", message: `${recipe.title} ingredient ${ingredient.name} is unsafe for ${member.name ?? member.id}.`, productId: product.id, memberId });
          safeIds.delete(memberId);
        } else if (results.includes("unknown")) {
          blockers.push({ code: "restriction_unverified", message: `${recipe.title} ingredient ${ingredient.name} cannot be verified for ${member.name ?? member.id}.`, productId: product.id, memberId });
          safeIds.delete(memberId);
        }
      }

      const requiredAmount = Math.round(ingredient.amount * scale * 1000) / 1000;
      const purchaseQuantity = Math.ceil(requiredAmount / product.packageSize.amount);
      const selectedProduct: VerifiedProduct = {
        ...product,
        lookupProductId: ingredient.productId,
        quantity: purchaseQuantity,
        assignedMemberIds: assignedIds,
        reason: `Ingredient for ${recipe.title}.`,
        lineTotalUah: Math.round(product.priceUah * purchaseQuantity * 100) / 100,
      };
      selectedProducts.push(selectedProduct);
      ingredients.push({
        name: ingredient.name,
        baseAmount: ingredient.amount,
        requiredAmount,
        unit: ingredient.unit,
        purchaseQuantity,
        purchasedAmount: product.packageSize.amount * purchaseQuantity,
        selectedProduct,
      });
    }

    if (fullyResolved) {
      const foodPerAssignedMember = recipe.ingredients
        .filter((ingredient) => ingredient.unit === "g")
        .reduce((sum, ingredient) => sum + ingredient.amount * scale, 0) / assignedIds.length;
      for (const memberId of safeIds) coverage[memberId].foodGrams += foodPerAssignedMember;
    }
    recipes.push({
      title: recipe.title,
      source: recipe.source,
      sourceUrl: recipe.sourceUrl,
      baseServings: recipe.servings,
      servings: assignedIds.length,
      assignedMemberIds: [...safeIds],
      ingredients,
      steps: recipe.steps,
    });
  }

  const candidateSets = new Map(wishCandidates.map((set) => [`${set.memberId}:${set.wishId}`, set]));
  const proposedFulfillments = new Map((proposal.wishFulfillments ?? []).map((item) => [`${item.memberId}:${item.wishId}`, item]));
  const knownWishKeys = new Set(input.currentParty.members.flatMap((member) => (member.wishes ?? []).map((wish) => `${member.id}:${wish.id}`)));
  if (proposedFulfillments.size !== (proposal.wishFulfillments ?? []).length
    || [...proposedFulfillments.keys()].some((key) => !knownWishKeys.has(key))) {
    blockers.push({ code: "invalid_fulfillment", message: "Wish fulfillment references must be unique and belong to current party wishes." });
  }
  const wishFulfillments: WishFulfillment[] = [];
  for (const member of input.currentParty.members) {
    for (const wish of member.wishes ?? []) {
      const key = `${member.id}:${wish.id}`;
      const requestedStrategy = wish.fulfillmentStrategy ?? "either";
      const candidates = candidateSets.get(key)?.candidates ?? [];
      const proposed = proposedFulfillments.get(key);
      const restrictions = [...new Set([...partyWideRestrictions, ...(member.restrictions ?? [])])];
      const safeCandidates = candidates.filter(({ product }) => product.available
        && restrictions.every((restriction) => restrictionSafety(product, restriction) === "safe"));

      if (requestedStrategy === "ready_made" && !safeCandidates.length) {
        blockers.push({ code: "no_suitable_ready_made", message: `No suitable ready-made Silpo product was found for ${wish.text}.`, memberId: member.id });
        continue;
      }

      if (!proposed) {
        blockers.push({ code: "wish_unfulfilled", message: `${wish.text} is not fulfilled for ${member.name ?? member.id}.`, memberId: member.id });
        continue;
      }

      const selectedProductIds = proposed.selectedProductIds ?? [];
      const recipeTitle = proposed.recipeTitle ?? null;
      const fallbackReason = proposed.fallbackReason ?? null;

      if (proposed.memberId !== member.id || proposed.wishId !== wish.id || proposed.resolvedStrategy === "recipe" && requestedStrategy === "ready_made") {
        blockers.push({ code: "invalid_fulfillment", message: `${wish.text} uses an invalid fulfillment strategy.`, memberId: member.id });
        continue;
      }

      if (proposed.resolvedStrategy === "ready_made") {
        const candidateIds = new Set(candidates.map((candidate) => candidate.lookupProductId));
        const valid = selectedProductIds.length > 0 && selectedProductIds.every((id) => {
          const selection = verifiedSelections.get(id);
          return candidateIds.has(id) && selection?.assignedMemberIds.includes(member.id);
        });
        if (!valid) blockers.push({ code: "invalid_fulfillment", message: `${wish.text} must use hydrated candidates assigned to ${member.name ?? member.id}.`, memberId: member.id });
      } else {
        const matchingRecipe = recipes.find((recipe) => recipe.title === recipeTitle && recipe.assignedMemberIds.includes(member.id));
        const fallbackIsValid = requestedStrategy === "recipe"
          ? fallbackReason === "explicit_cooking"
          : fallbackReason === "poor_match"
            || fallbackReason === "no_candidates" && candidates.length === 0
            || fallbackReason === "no_safe_candidate" && candidates.length > 0 && safeCandidates.length === 0;
        if (!matchingRecipe || selectedProductIds.length || !fallbackIsValid) {
          blockers.push({ code: "invalid_fulfillment", message: `${wish.text} has an invalid recipe fallback.`, memberId: member.id });
        }
      }

      wishFulfillments.push({
        memberId: member.id,
        wishId: wish.id,
        requestedStrategy,
        resolvedStrategy: proposed.resolvedStrategy,
        candidateProductIds: candidates.map((candidate) => candidate.product.id),
        selectedProductIds: selectedProductIds.flatMap((id) => verifiedSelections.get(id)?.id ?? []),
        recipeTitle,
        fallbackReason,
      });
    }
  }

  for (const member of input.currentParty.members) {
    if (coverage[member.id].foodGrams < targets.foodGramsPerPerson) {
      blockers.push({ code: "insufficient_food", message: `${member.name ?? member.id} does not have enough verified food.`, memberId: member.id });
    }
    if (coverage[member.id].drinkMilliliters < targets.drinkMillilitersPerPerson) {
      blockers.push({ code: "insufficient_drink", message: `${member.name ?? member.id} does not have enough verified drinks.`, memberId: member.id });
    }
  }

  if (!proposal.selections.length && !(proposal.recipes?.length)) {
    blockers.push({ code: "no_suitable_products", message: "Silpo search returned no suitable products." });
  }

  const totalUah = Math.round(selectedProducts.reduce((sum, product) => sum + product.lineTotalUah, 0) * 100) / 100;
  const warnings: Warning[] = [];
  if (budgetUah !== null && totalUah > budgetUah) {
    const amountUah = Math.round((totalUah - budgetUah) * 100) / 100;
    warnings.push({ code: "budget_exceeded", message: `The plan exceeds the budget by ${amountUah} UAH.`, amountUah });
  }
  const readiness = blockers.length ? "invalid" as const : "ready" as const;
  const draft: PartyPlanDraft = {
    summary: `Party plan for ${input.currentParty.members.length} participants with ${selectedProducts.length} verified Silpo products.`,
    products: selectedProducts,
    recipes,
    totalUah,
    coverage,
    wishFulfillments,
  };
  return { readiness, blockers, warnings, selectedProducts, coverage, totalUah, draft };
}
