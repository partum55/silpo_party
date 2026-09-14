export type AgentStatus = "IDLE" | "THINKING" | "SEARCHING" | "UPDATING_CART" | "DONE" | "ERROR";

/** Label shown in the chat's thinking bubble for each in-progress agent status. Statuses absent here (IDLE, DONE, ERROR) aren't "thinking". */
export const AGENT_THINKING_COPY: Partial<Record<AgentStatus, string>> = {
  THINKING: "Агент думає…",
  SEARCHING: "Шукає товари…",
  UPDATING_CART: "Оновлює кошик…",
};
