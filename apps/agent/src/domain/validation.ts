import type {
  Blocker,
  FoundRecipe,
  PartyPlanningInput,
  PlannerProposal,
  Warning,
} from "./schemas.ts";
import { productLineTotalUah } from "./purchasing.ts";

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
  imageUrl?: string;
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

const pantryStaple = /^(salt|sea salt|black pepper|pepper|water|tap water|olive oil|vegetable oil|cooking oil|сіль|морська сіль|чорний перець|перець|вода|оливкова олія|рослинна олія|олія)$/i;

export function isPantryStaple(name: string) {
  return pantryStaple.test(name.trim().toLocaleLowerCase("uk"));
}

const vegetarianAnimal = /chicken|beef|pork|turkey|duck|meat|fish|salmon|tuna|shrimp|seafood|gelatin|lard|курк|ялович|свинин|індич|качк|м['’]?яс|риб|лосос|тунц|кревет|морепродукт|желатин|смалец|бекон|шинка|ковбас|сосиск|анчоус|ікра/;
const wholePlant = /tomato|potato|cucumber|carrot|cabbage|pepper|onion|garlic|apple|banana|grape|orange|pear|berry|fruit|vegetable|almond|peanut|hazelnut|cashew|pistachio|nut|томат|помідор|картоп|огір|моркв|капуст|перець|цибул|часник|яблук|банан|виноград|апельс|мандарин|груш|ягод|фрукт|овоч|мигдал|арахіс|фундук|кеш['’]?ю|фісташ|горіх/;
const processedFood = /закуск|салат|соус|піца|сендвіч|бургер|торт|печив|цукерк|десерт|йогурт|чипс|паста|марин|консерв|напівфабрикат|snack|salad|sauce|pizza|sandwich|burger|cake|cookie|candy|dessert|yogurt|chips|flavou?r/;
const leafyProduce = /листов|зелень|рукол|шпинат|leafy|greens|arugula|spinach/;

type IngredientRestrictionRule = {
  restriction: RegExp;
  forbidden: RegExp;
  explicitlySafe: RegExp;
  forbiddenName?: RegExp;
  allowUnlabeledDrinks?: boolean;
};

// Covers the common dietary exclusions and the major food-allergen families returned by Silpo. These are
// deliberately stem-based because profile values and catalog attributes may independently be Ukrainian or
// English and use different grammatical forms.
const ingredientRestrictionRules: IngredientRestrictionRule[] = [
  { restriction: /lactose|lactoza|лактоз/, forbidden: /lactose|лактоз|milk|cream|молок|вершк/, explicitlySafe: /lactose[- ]?free|без\s*лактоз|безлактоз/, forbiddenName: /молоко|вершк|сметан|кефір|йогурт|dairy milk|cow'?s? milk|cream|yogurt|kefir/, allowUnlabeledDrinks: true },
  { restriction: /gluten|глютен|celiac|целіак/, forbidden: /gluten|wheat|barley|rye|spelt|пшениц|ячмін|жит(?:о|н)|полб/, explicitlySafe: /gluten[- ]?free|без\s*глютен|безглютен/ },
  { restriction: /peanut|арахіс/, forbidden: /peanut|groundnut|арахіс/, explicitlySafe: /peanut[- ]?free|без\s*арахіс/ },
  { restriction: /tree nuts?|горіх|мигдал|фундук|кеш['’]?ю|фісташ/, forbidden: /tree nuts?|nut|almond|hazelnut|cashew|pistachio|walnut|pecan|macadamia|горіх|мигдал|фундук|кеш['’]?ю|фісташ|пекан|макадам/, explicitlySafe: /nut[- ]?free|без\s*горіх/ },
  { restriction: /milk allergy|dairy|алерг\S*.*молок|молочн\S*.*алерг/, forbidden: /milk|cream|butter|whey|casein|cheese|yogurt|молок|вершк|масло|сироват|казеїн|сир|йогурт/, explicitlySafe: /dairy[- ]?free|milk[- ]?free|без\s*молочн|без\s*молок/ },
  { restriction: /eggs?|яйц/, forbidden: /eggs?|albumen|ovalbumin|яйц|альбумін/, explicitlySafe: /egg[- ]?free|без\s*яєць|без\s*яйц/ },
  { restriction: /soy|soya|со[єїй]/, forbidden: /soy|soya|со[єїй]/, explicitlySafe: /soy[- ]?free|без\s*со[їєй]/ },
  { restriction: /sesame|кунжут/, forbidden: /sesame|tahini|кунжут|тахін/, explicitlySafe: /sesame[- ]?free|без\s*кунжут/ },
  { restriction: /mustard|гірчиц/, forbidden: /mustard|гірчиц/, explicitlySafe: /mustard[- ]?free|без\s*гірчиц/ },
  { restriction: /celery|селер/, forbidden: /celery|селер/, explicitlySafe: /celery[- ]?free|без\s*селер/ },
  { restriction: /lupin|люпин/, forbidden: /lupin|люпин/, explicitlySafe: /lupin[- ]?free|без\s*люпин/ },
  { restriction: /fish|риб/, forbidden: /fish|salmon|tuna|anchov|caviar|риб|лосос|тунц|анчоус|ікра/, explicitlySafe: /fish[- ]?free|без\s*риб/ },
  { restriction: /shellfish|seafood|crustacean|mollusc|морепродукт|ракоподіб|молюск|кревет/, forbidden: /shellfish|seafood|shrimp|prawn|crab|lobster|mussel|oyster|squid|морепродукт|кревет|краб|омар|міді|устриц|кальмар/, explicitlySafe: /shellfish[- ]?free|seafood[- ]?free|без\s*морепродукт/ },
  { restriction: /sulphite|sulfite|діоксид сірки|сульфіт/, forbidden: /sulphite|sulfite|sulfur dioxide|e22[0-8]|діоксид сірки|сульфіт/, explicitlySafe: /sulphite[- ]?free|sulfite[- ]?free|без\s*сульфіт/ },
  { restriction: /sugar|цукр|без солодк/, forbidden: /sugar|sucrose|glucose|fructose|syrup|цукор|цукр|сахароз|глюкоз|фруктоз|сироп/, explicitlySafe: /sugar[- ]?free|no added sugar|без\s*(?:доданого\s*)?цукр|безцукр/ },
  { restriction: /alcohol|алкогол/, forbidden: /alcohol|ethanol|beer|wine|rum|brandy|liqueur|алкогол|етанол|спирт|пиво|вин[оа]|ром|бренді|лікер/, explicitlySafe: /alcohol[- ]?free|non[- ]?alcoholic|безалкогол/ },
  { restriction: /caffeine|кофеїн/, forbidden: /caffeine|coffee|кофеїн|кав[аи]/, explicitlySafe: /caffeine[- ]?free|decaf|без\s*кофеїн|безкофеїн/ },
  { restriction: /pork|свинин|без м['’]?яса свин/, forbidden: /pork|bacon|ham|lard|свинин|бекон|шинка|смалец/, explicitlySafe: /pork[- ]?free|без\s*свинин/ },
  { restriction: /beef|ялович/, forbidden: /beef|veal|ялович|телятин/, explicitlySafe: /beef[- ]?free|без\s*ялович/ },
  { restriction: /salt|sodium|сіль|натрі/, forbidden: /salt|sodium|сіль|натрі/, explicitlySafe: /salt[- ]?free|sodium[- ]?free|без\s*солі|безсольов/ },
];

function hasReadableComposition(ingredients: string, allergens: string) {
  return Boolean(ingredients || allergens);
}

function isObviouslyUnaffectedWholeFood(product: HydratedProduct, name: string) {
  return /(^|\s)(water|вода)(\s|$)/.test(name)
    || (product.category === "food" && wholePlant.test(name) && !processedFood.test(name));
}

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
    const animalProduct = /milk|cream|butter|whey|casein|cheese|yogurt|egg|honey|meat|fish|gelatin|lard|молок|вершк|масло|сироват|казеїн|сир|йогурт|яйц|мед|м['’]?яс|риб|желатин|смалец/;
    const plantAlternative = /plant[- ]?based|oat|soy|almond|coconut|rice drink|рослинн|вівсян|соєв|мигдал|кокос|рисов.*напій/;
    if (/vegan|веган/.test(`${name} ${labels}`)) return "safe";
    if (plantAlternative.test(name) && !animalProduct.test(`${ingredients} ${allergens}`)) return "safe";
    if (animalProduct.test(`${ingredients} ${allergens} ${name}`)) return "unsafe";
    if (hasReadableComposition(ingredients, allergens) || isObviouslyUnaffectedWholeFood(product, name)) return "safe";
    return "unknown";
  }

  if (value.match(/pescatar|пескетар/)) {
    const landAnimal = /chicken|beef|pork|turkey|duck|meat|gelatin|lard|курк|ялович|свинин|індич|качк|м['’]?яс|желатин|смалец|бекон|шинка|ковбас|сосиск/;
    if (landAnimal.test(`${ingredients} ${allergens} ${name}`)) return "unsafe";
    if (/pescatar|пескетар/.test(`${name} ${labels}`) || hasReadableComposition(ingredients, allergens) || isObviouslyUnaffectedWholeFood(product, name)) return "safe";
    return "unknown";
  }

  if (value.match(/halal|халяль/)) {
    if (/halal|халяль/.test(`${name} ${labels}`)) return "safe";
    if (/pork|bacon|ham|lard|alcohol|свинин|бекон|шинка|смалец|алкогол|спирт/.test(`${ingredients} ${allergens} ${name}`)) return "unsafe";
    return "unknown";
  }

  if (value.match(/kosher|кошер/)) {
    if (/kosher|кошер/.test(`${name} ${labels}`)) return "safe";
    if (/pork|bacon|ham|lard|shellfish|shrimp|crab|свинин|бекон|шинка|смалец|кревет|краб/.test(`${ingredients} ${allergens} ${name}`)) return "unsafe";
    return "unknown";
  }

  const rule = ingredientRestrictionRules.find((candidate) => candidate.restriction.test(value));
  if (rule) {
    if (rule.explicitlySafe.test(`${name} ${labels}`)) return "safe";
    if (rule.forbidden.test(`${ingredients} ${allergens}`) || rule.forbiddenName?.test(name)) return "unsafe";
    if (hasReadableComposition(ingredients, allergens) || isObviouslyUnaffectedWholeFood(product, name)) return "safe";
    // Silpo omits composition/allergen attributes for some catalog drinks (observed for kvass). A named
    // non-dairy beverage cannot violate lactose intolerance merely because that optional metadata is absent.
    if (rule.allowUnlabeledDrinks && product.category === "drink") return "safe";
  }

  // Unknown profile restrictions are never silently ignored. The planner may only use a product when its
  // Silpo name/labels explicitly repeat that restriction; otherwise validation blocks the assignment.
  if (labels.includes(value) || name.includes(value)) return "safe";
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
  mode = "EVENT",
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
  mode?: "SHOPPING" | "DINNER" | "EVENT";
}) {
  const effectiveTargets = mode === "EVENT" ? targets : { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 };
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
      blockers.push({ code: "product_not_found", message: `Товар Silpo ${selection.productId} не знайдено.`, productId: selection.productId });
      continue;
    }
    if (!product.available) {
      blockers.push({ code: "product_unavailable", message: `Товар «${product.name}» недоступний.`, productId: product.id });
      continue;
    }
    const assignedIds = [...new Set(selection.assignedMemberIds)];
    const unknownIds = assignedIds.filter((id) => !members.has(id));
    if (unknownIds.length) {
      blockers.push({ code: "invalid_assignment", message: `Товар «${product.name}» призначено невідомим учасникам.`, productId: product.id });
      continue;
    }

    const safeIds: string[] = [];
    for (const memberId of assignedIds) {
      const member = members.get(memberId)!;
      const restrictions = [...new Set([...partyWideRestrictions, ...(member.restrictions ?? [])])];
      const results = restrictions.map((restriction) => restrictionSafety(product, restriction));
      if (results.includes("unsafe")) {
        blockers.push({ code: "restriction_violation", message: `Товар «${product.name}» не підходить для ${member.name ?? member.id}.`, productId: product.id, memberId });
      } else if (results.includes("unknown")) {
        blockers.push({ code: "restriction_unverified", message: `Не вдалося перевірити товар «${product.name}» для ${member.name ?? member.id}.`, productId: product.id, memberId });
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
      reason: `Призначено для ${assignedIds.length} учасн${assignedIds.length === 1 ? "ика" : "иків"}.`,
      lineTotalUah: productLineTotalUah(product, selection.quantity),
    };
    selectedProducts.push(verified);
    verifiedSelections.set(selection.productId, verified);
  }

  for (const proposedRecipe of proposal.recipes ?? []) {
    let recipe = proposedRecipe;
    if (proposedRecipe.source === "web") {
      const sourced = await resolveRecipe?.(proposedRecipe.title);
      if (!sourced) {
        blockers.push({ code: "recipe_unresolved", message: `Не вдалося підтвердити рецепт «${proposedRecipe.title}» із надійного джерела.` });
        continue;
      }
      const productIds = new Map(proposedRecipe.ingredients.map((ingredient) => [ingredient.name.trim().toLocaleLowerCase(), ingredient.productId]));
      const purchasableIngredients = sourced.ingredients.filter((ingredient) => !isPantryStaple(ingredient.name));
      if (purchasableIngredients.some((ingredient) => !productIds.has(ingredient.name.trim().toLocaleLowerCase()))) {
        blockers.push({ code: "recipe_ingredient_mapping_missing", message: `Не для кожного інгредієнта рецепта «${sourced.title}» знайдено товар Silpo.` });
        continue;
      }
      recipe = {
        ...sourced,
        assignedMemberIds: proposedRecipe.assignedMemberIds,
        ingredients: purchasableIngredients.map((ingredient) => ({
          ...ingredient,
          productId: productIds.get(ingredient.name.trim().toLocaleLowerCase())!,
        })),
      };
    } else {
      recipe = { ...recipe, ingredients: recipe.ingredients.filter((ingredient) => !isPantryStaple(ingredient.name)) };
    }

    const assignedIds = [...new Set(recipe.assignedMemberIds)];
    const unknownIds = assignedIds.filter((id) => !members.has(id));
    if (unknownIds.length) {
      blockers.push({ code: "invalid_assignment", message: `Рецепт «${recipe.title}» призначено невідомим учасникам.` });
      continue;
    }
    let fullyResolved = true;
    const safeIds = new Set(assignedIds);
    const ingredients: VerifiedRecipe["ingredients"] = [];
    const scale = assignedIds.length / recipe.servings;

    for (const ingredient of recipe.ingredients) {
      const product = await hydrate(ingredient.productId);
      if (!product) {
        blockers.push({ code: "product_not_found", message: `Товар Silpo ${ingredient.productId} для «${ingredient.name}» не знайдено.`, productId: ingredient.productId });
        fullyResolved = false;
        continue;
      }
      if (!product.available) {
        blockers.push({ code: "product_unavailable", message: `Товар «${product.name}» для «${ingredient.name}» недоступний.`, productId: product.id });
        fullyResolved = false;
        continue;
      }
      if (product.packageSize.unit !== ingredient.unit) {
        blockers.push({ code: "recipe_unit_mismatch", message: `Для «${ingredient.name}» потрібна одиниця ${ingredient.unit}, але «${product.name}» продається в ${product.packageSize.unit}.`, productId: product.id });
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
          blockers.push({ code: "restriction_violation", message: `Інгредієнт «${ingredient.name}» у рецепті «${recipe.title}» не підходить для ${member.name ?? member.id}.`, productId: product.id, memberId });
          safeIds.delete(memberId);
        } else if (results.includes("unknown")) {
          blockers.push({ code: "restriction_unverified", message: `Не вдалося перевірити інгредієнт «${ingredient.name}» у рецепті «${recipe.title}» для ${member.name ?? member.id}.`, productId: product.id, memberId });
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
        reason: `Інгредієнт для рецепта «${recipe.title}».`,
        lineTotalUah: productLineTotalUah(product, purchaseQuantity),
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
    blockers.push({ code: "invalid_fulfillment", message: "Посилання на виконання побажань мають бути унікальними й належати поточній вечірці." });
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
        blockers.push({ code: "no_suitable_ready_made", message: `Для побажання «${wish.text}» не знайдено відповідного готового товару Silpo.`, memberId: member.id });
        continue;
      }

      if (!proposed) {
        blockers.push({ code: "wish_unfulfilled", message: `Побажання «${wish.text}» не виконано для ${member.name ?? member.id}.`, memberId: member.id });
        continue;
      }

      const selectedProductIds = proposed.selectedProductIds ?? [];
      const recipeTitle = proposed.recipeTitle ?? null;
      const fallbackReason = proposed.fallbackReason ?? null;

      if (proposed.memberId !== member.id || proposed.wishId !== wish.id || proposed.resolvedStrategy === "recipe" && requestedStrategy === "ready_made") {
        blockers.push({ code: "invalid_fulfillment", message: `Для побажання «${wish.text}» вибрано некоректний спосіб виконання.`, memberId: member.id });
        continue;
      }

      if (proposed.resolvedStrategy === "ready_made") {
        const candidateIds = new Set(candidates.map((candidate) => candidate.lookupProductId));
        const valid = selectedProductIds.length > 0 && selectedProductIds.every((id) => {
          const selection = verifiedSelections.get(id);
          return candidateIds.has(id) && selection?.assignedMemberIds.includes(member.id);
        });
        if (!valid) blockers.push({ code: "invalid_fulfillment", message: `Для побажання «${wish.text}» слід використати перевірені товари, призначені для ${member.name ?? member.id}.`, memberId: member.id });
      } else {
        const matchingRecipe = recipes.find((recipe) => recipe.title === recipeTitle && recipe.assignedMemberIds.includes(member.id));
        const fallbackIsValid = requestedStrategy === "recipe"
          ? fallbackReason === "explicit_cooking"
          : fallbackReason === "poor_match"
            || fallbackReason === "no_candidates" && candidates.length === 0
            || fallbackReason === "no_safe_candidate" && candidates.length > 0 && safeCandidates.length === 0;
        if (!matchingRecipe || selectedProductIds.length || !fallbackIsValid) {
          blockers.push({ code: "invalid_fulfillment", message: `Для побажання «${wish.text}» вибрано некоректну заміну рецептом.`, memberId: member.id });
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
    if (coverage[member.id].foodGrams < effectiveTargets.foodGramsPerPerson) {
      blockers.push({ code: "insufficient_food", message: `Для ${member.name ?? member.id} недостатньо перевіреної їжі.`, memberId: member.id });
    }
    if (coverage[member.id].drinkMilliliters < effectiveTargets.drinkMillilitersPerPerson) {
      blockers.push({ code: "insufficient_drink", message: `Для ${member.name ?? member.id} недостатньо перевірених напоїв.`, memberId: member.id });
    }
  }

  if (!proposal.selections.length && !(proposal.recipes?.length)) {
    blockers.push({ code: "no_suitable_products", message: "Пошук Silpo не знайшов відповідних товарів." });
  }

  const totalUah = Math.round(selectedProducts.reduce((sum, product) => sum + product.lineTotalUah, 0) * 100) / 100;
  const warnings: Warning[] = [];
  if (budgetUah !== null && totalUah > budgetUah) {
    const amountUah = Math.round((totalUah - budgetUah) * 100) / 100;
    warnings.push({ code: "budget_exceeded", message: `План перевищує бюджет на ${amountUah} грн.`, amountUah });
  }
  const readiness = blockers.length ? "invalid" as const : "ready" as const;
  const draft: PartyPlanDraft = {
    summary: `План вечірки для ${input.currentParty.members.length} учасників із ${selectedProducts.length} перевіреними товарами Silpo.`,
    products: selectedProducts,
    recipes,
    totalUah,
    coverage,
    wishFulfillments,
  };
  return { readiness, blockers, warnings, selectedProducts, coverage, totalUah, draft };
}
