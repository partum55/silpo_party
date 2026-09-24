import { z } from "zod";

export const measureUnitSchema = z.enum(["g", "ml", "piece"]);
export type MeasureUnit = z.infer<typeof measureUnitSchema>;

const hydratedProductShape = {
  id: z.string(),
  lookupProductId: z.string().optional(),
  /** Silpo catalog slug: lets a later turn or finalization refresh the product without searching again. */
  slug: z.string().optional(),
  companyId: z.string().optional(),
  name: z.string(),
  imageUrl: z.string().url().optional(),
  priceUah: z.number(),
  unit: z.string(),
  available: z.boolean(),
  weighted: z.boolean().optional(),
  category: z.enum(["food", "drink", "non_food"]),
  packageSize: z.object({ amount: z.number(), unit: measureUnitSchema }),
  metadata: z.object({
    ingredients: z.array(z.string()),
    allergens: z.array(z.string()),
    labels: z.array(z.string()),
    composition: z.array(z.string()).optional(),
  }),
};

export const productSchema = z.object({
  ...hydratedProductShape,
  // Kept permissive for legacy persisted plans.
  quantity: z.number().positive(),
  assignedMemberIds: z.array(z.string()),
  reason: z.string(),
  lineTotalUah: z.number(),
  /** Which request produced this line: `item:<query>` for direct products, `ingredient:<name>:<unit>` for recipes. */
  requestKey: z.string().optional(),
});

const recipeIngredientSchema = z.object({
  name: z.string(),
  baseAmount: z.number().positive(),
  requiredAmount: z.number().positive(),
  unit: measureUnitSchema,
  purchaseQuantity: z.number().int().positive(),
  purchasedAmount: z.number().positive(),
  selectedProduct: productSchema,
});

const missingIngredientSchema = z.object({
  name: z.string(),
  baseAmount: z.number().positive(),
  requiredAmount: z.number().positive(),
  unit: measureUnitSchema,
});

export const recipeSchema = z.object({
  title: z.string(),
  /** Normalized dish request this recipe fulfils; recipes are matched by it across turns. */
  dishKey: z.string().optional(),
  source: z.enum(["web", "generated"]),
  sourceUrl: z.string().nullable(),
  baseServings: z.number().positive(),
  servings: z.number().int().positive(),
  assignedMemberIds: z.array(z.string()),
  ingredients: z.array(recipeIngredientSchema),
  /** Ingredients for which no Silpo product could be found; the recipe stays usable without them. */
  missingIngredients: z.array(missingIngredientSchema).optional(),
  steps: z.array(z.string()),
});

const wishFulfillmentSchema = z.object({
  memberId: z.string(),
  wishId: z.string(),
  requestedStrategy: z.enum(["ready_made", "recipe", "either"]),
  resolvedStrategy: z.enum(["ready_made", "recipe"]),
  candidateProductIds: z.array(z.string()),
  selectedProductIds: z.array(z.string()),
  recipeTitle: z.string().nullable(),
  fallbackReason: z.enum(["explicit_cooking", "no_candidates", "no_safe_candidate", "poor_match"]).nullable(),
});

export const planSchema = z.object({
  summary: z.string(),
  products: z.array(productSchema),
  recipes: z.array(recipeSchema),
  totalUah: z.number(),
  coverage: z.record(z.string(), z.object({ foodGrams: z.number(), drinkMilliliters: z.number() })),
  wishFulfillments: z.array(wishFulfillmentSchema),
  /** Recipe ingredient keys a member removed; recipe rebuilds must not add them back. */
  excludedIngredientKeys: z.array(z.string()).optional(),
});

export type HydratedProduct = Omit<z.infer<z.ZodObject<typeof hydratedProductShape>>, "lookupProductId">;
export type VerifiedProduct = z.infer<typeof productSchema>;
export type VerifiedRecipe = z.infer<typeof recipeSchema>;
export type WishFulfillment = z.infer<typeof wishFulfillmentSchema>;
export type PartyPlanDraft = z.infer<typeof planSchema>;

/** A catalog product found in this turn, with the identifiers needed to add it to a plan and refresh it later. */
export type CatalogProduct = HydratedProduct & { lookupProductId: string; slug?: string };

export function emptyPlan(): PartyPlanDraft {
  return { summary: "", products: [], recipes: [], totalUah: 0, coverage: {}, wishFulfillments: [] };
}
