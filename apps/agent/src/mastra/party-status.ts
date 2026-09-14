import type { RequestContext } from "@mastra/core/request-context";

/**
 * Reports which phase of a chat turn is in progress (see conversational-workflow.ts) so the root app's
 * chat UI can show it instead of one static "thinking" label. Best-effort: a failed callback must never
 * break the actual turn, so errors are swallowed. partyId is absent for the older party-planning workflow
 * (parties without an id, e.g. a design-time run), which just skips reporting.
 */
export async function reportAgentStatus(requestContext: RequestContext, status: "THINKING" | "SEARCHING") {
  const partyId = requestContext.get("partyId") as string | undefined;
  const appUrl = process.env.APP_URL;
  const token = process.env.AGENT_INTERNAL_TOKEN;
  if (!partyId || !appUrl || !token) return;
  try {
    await fetch(`${appUrl}/api/parties/${partyId}/agent-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ agentStatus: status }),
    });
  } catch (error) {
    console.error("reportAgentStatus: callback failed", error);
  }
}
