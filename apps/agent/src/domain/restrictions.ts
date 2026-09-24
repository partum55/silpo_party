// Food-restriction rules. Deferred: not on the agent's hot path until restrictions are wired back into
// candidate selection (see resolve-items.ts). Kept intact so they can be re-enabled without rewriting them.
import type { HydratedProduct } from "./plan.ts";

type RestrictionResult = "safe" | "unsafe" | "unknown";

const normalize = (values: string[]) => values.join(" ").toLocaleLowerCase("uk");

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
  allowWhenNameUnrelated?: boolean;
};

// Covers the common dietary exclusions and the major food-allergen families returned by Silpo. These are
// deliberately stem-based because profile values and catalog attributes may independently be Ukrainian or
// English and use different grammatical forms.
const ingredientRestrictionRules: IngredientRestrictionRule[] = [
  { restriction: /lactose|lactoza|лактоз/, forbidden: /lactose|лактоз|milk|cream|butter|whey|cheese|молок|вершк|масло|сироват|сир/, explicitlySafe: /lactose[- ]?free|без\s*лактоз|безлактоз/, forbiddenName: /молоко|вершк|сметан|кефір|йогурт|масло|сироват|сир|dairy milk|cow'?s? milk|cream|yogurt|kefir|butter|whey|cheese/, allowUnlabeledDrinks: true, allowWhenNameUnrelated: true },
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
  if (product.category === "non_food") return "safe";
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
    // Lactose intolerance is relevant only when the catalog identifies a dairy signal. Unlike an allergy,
    // an unrelated product name with sparse optional composition metadata is not evidence of lactose.
    if (rule.allowWhenNameUnrelated && !rule.forbiddenName?.test(name)) return "safe";
  }

  // Unknown profile restrictions are never silently ignored. The planner may only use a product when its
  // Silpo name/labels explicitly repeat that restriction; otherwise validation blocks the assignment.
  if (labels.includes(value) || name.includes(value)) return "safe";
  return "unknown";
}

export function productRestrictionSafety(product: HydratedProduct, restrictions: string[]): RestrictionResult {
  const results = restrictions.map((restriction) => restrictionSafety(product, restriction));
  if (results.includes("unsafe")) return "unsafe";
  if (results.includes("unknown")) return "unknown";
  return "safe";
}
