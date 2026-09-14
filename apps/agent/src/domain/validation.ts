import type {
  Blocker,
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
  packageSize: { amount: number; unit: "g" | "ml" };
  metadata: ProductMetadata;
};

export type VerifiedProduct = HydratedProduct & {
  quantity: number;
  assignedMemberIds: string[];
  reason: string;
  lineTotalUah: number;
};

export type PartyPlanDraft = {
  summary: string;
  products: VerifiedProduct[];
  totalUah: number;
  coverage: Record<string, { foodGrams: number; drinkMilliliters: number }>;
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
  targets = coverageTargets,
}: {
  input: PartyPlanningInput;
  budgetUah: number | null;
  partyWideRestrictions: string[];
  proposal: PlannerProposal;
  hydrate: (productId: string) => Promise<HydratedProduct | null>;
  targets?: { foodGramsPerPerson: number; drinkMillilitersPerPerson: number };
}) {
  const members = new Map(input.currentParty.members.map((member) => [member.id, member]));
  const coverage = Object.fromEntries(
    input.currentParty.members.map((member) => [member.id, { foodGrams: 0, drinkMilliliters: 0 }]),
  );
  const blockers: Blocker[] = [];
  const selectedProducts: VerifiedProduct[] = [];

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
      const restrictions = [...new Set([...partyWideRestrictions, ...member.restrictions])];
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
      if (product.category === "food") {
        coverage[memberId].foodGrams += amountPerMember;
      } else {
        coverage[memberId].drinkMilliliters += amountPerMember;
      }
    }

    selectedProducts.push({
      ...product,
      quantity: selection.quantity,
      assignedMemberIds: assignedIds,
      reason: `Assigned to ${assignedIds.length} participant${assignedIds.length === 1 ? "" : "s"}.`,
      lineTotalUah: Math.round(product.priceUah * selection.quantity * 100) / 100,
    });
  }

  for (const member of input.currentParty.members) {
    if (coverage[member.id].foodGrams < targets.foodGramsPerPerson) {
      blockers.push({ code: "insufficient_food", message: `${member.name ?? member.id} does not have enough verified food.`, memberId: member.id });
    }
    if (coverage[member.id].drinkMilliliters < targets.drinkMillilitersPerPerson) {
      blockers.push({ code: "insufficient_drink", message: `${member.name ?? member.id} does not have enough verified drinks.`, memberId: member.id });
    }
  }

  if (!proposal.selections.length) {
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
    totalUah,
    coverage,
  };
  return { readiness, blockers, warnings, selectedProducts, coverage, totalUah, draft };
}
