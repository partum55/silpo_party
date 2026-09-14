export class CartMutationError extends Error {
  constructor(
    readonly code: "invalid_quantity" | "cart_item_not_found" | "cart_item_changed",
    readonly status: 400 | 404 | 409,
  ) {
    super(code);
  }
}
