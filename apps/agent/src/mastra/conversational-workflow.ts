import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { RequestContext } from "@mastra/core/request-context";

import { agentCache } from "../cache/index.ts";
import { conversationInputSchema, conversationOutputSchema } from "../domain/turn-schema.ts";
import { createLlm, type TextGenerator } from "../llm/json.ts";
import { createDeadline } from "../pipeline/deadline.ts";
import { AGENT_UNAVAILABLE_RESPONSE, readOnlyResult, runTurn } from "../pipeline/turn.ts";
import { withCatalogSession } from "../silpo/catalog.ts";
import { fastAgent, smartAgent } from "./party-planner-agent.ts";
import { reportAgentStatus } from "./party-status.ts";

export { conversationInputSchema, conversationOutputSchema } from "../domain/turn-schema.ts";

/** The web app aborts a turn after 90 s (src/lib/agent/runner.ts); leave room for persistence and the reply. */
export const TURN_BUDGET_MS = 75_000;

export function silpoUserId(requestContext: RequestContext) {
  const userId = (requestContext.get("silpoUserId") as string | undefined) ?? process.env.SILPO_USER_ID;
  if (!userId) throw new Error("No Silpo user id in requestContext and no SILPO_USER_ID fallback is set.");
  return userId;
}

const generateText: TextGenerator = async (prompt, { role, signal }) => {
  const agent = role === "smart" ? smartAgent : fastAgent;
  const response = await agent.generate(prompt, { abortSignal: signal });
  // Mastra resolves an aborted call with empty text (finishReason "tripwire") instead of throwing; surface the
  // timeout so the JSON helper reports it as such and does not retry into an already-spent budget.
  signal.throwIfAborted();
  return response.text;
};

const conversationalTurn = createStep({
  id: "conversational-turn",
  description: "Routes one chat message to its scenario and returns the updated plan and reply.",
  inputSchema: conversationInputSchema,
  outputSchema: conversationOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const deadline = createDeadline(TURN_BUDGET_MS);
    await reportAgentStatus(requestContext, "THINKING");
    try {
      const userId = silpoUserId(requestContext);
      return await runTurn(inputData, {
        llm: createLlm(generateText, deadline),
        withSession: (operation) => withCatalogSession(userId, operation),
        cache: agentCache(),
        deadline,
        reportStatus: (status) => reportAgentStatus(requestContext, status),
      });
    } catch (error) {
      // runTurn degrades per item; anything reaching here is a bug or a platform failure. Keep the plan intact.
      console.error("conversationalTurn: unexpected failure", error);
      return readOnlyResult(inputData, AGENT_UNAVAILABLE_RESPONSE);
    }
  },
});

export const conversationalPartyWorkflow = createWorkflow({
  id: "conversational-party-workflow",
  description: "Applies one conversational turn to authoritative party state without persistence.",
  inputSchema: conversationInputSchema,
  outputSchema: conversationOutputSchema,
}).then(conversationalTurn).commit();
