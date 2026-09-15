import type { PackageSize } from "@/lib/cart/display";
import type { PartyMode } from "@/lib/party/mode-copy";

export type ChatMessage = {
  id: string;
  sender_type: "USER" | "AGENT" | "SYSTEM";
  sender_user_id: string | null;
  content: string;
  reply_to_message_id: string | null;
  created_at: string;
};

export type Member = {
  user_id: string;
  role: "CREATOR" | "MEMBER";
  joined_at: string;
  name: string;
  avatarUrl: string | null;
  wishes: Array<{ id: string; text: string; fulfillmentStrategy: "ready_made" | "recipe" | "either" }>;
  ready: boolean;
};

export type CartItem = {
  id: string;
  name: string;
  image_url: string | null;
  quantity: number;
  price_uah: number | null;
  package_size: PackageSize | null;
  line_total_uah: number;
  base_assigned_member_ids: string[];
  assigned_member_ids: string[];
  subscriber_member_ids: string[];
};

export type RecipeIngredient = {
  name: string;
  requiredAmount: number;
  unit: PackageSize["unit"];
  purchaseQuantity: number;
  purchasedAmount: number;
  selectedProduct: { name: string; packageSize: PackageSize };
};

export type Recipe = {
  title: string;
  sourceUrl: string | null;
  steps: string[];
  assignedMemberIds: string[];
  ingredients: RecipeIngredient[];
  cost_uah: number;
};

export type Cart = {
  status: "DRAFT" | "FINALIZED";
  total_uah: number | null;
  checkout_url: string | null;
  items: CartItem[];
  recipes: Recipe[];
  memberTotals: Array<{ memberId: string; amountUah: number }>;
};

export type PartyStatus = {
  status: "ACTIVE" | "COMPLETED";
  agent_status: string;
  agent_error: string | null;
  active_agent_message_id: string | null;
  join_code: string;
  mode: PartyMode;
  budget_uah: number | null;
};
