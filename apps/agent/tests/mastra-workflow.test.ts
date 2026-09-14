import assert from "node:assert/strict";
import test from "node:test";

import { mastra } from "../src/mastra/index.ts";
import { parsePlannerProposal } from "../src/mastra/party-planning-workflow.ts";

test("planner JSON is parsed and validated after tool use", () => {
  const proposal = parsePlannerProposal('Done:\n```json\n{"summary":"Draft","selections":[]}\n```');
  assert.equal(proposal.summary, "Draft");
});

test("workflow starts from its public input without duplicate initial state", async () => {
  const run = await mastra.getWorkflow("partyPlanningWorkflow").createRun();
  const result = await run.start({
    inputData: { request: "Plan a party", currentParty: { members: [] } },
  });

  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.result.readiness, "needs_input");
    assert.equal(result.result.preferencePhase, "provisional");
    assert.equal(result.result.questions[0]?.code, "party_members_required");
  }
});

test("conversational workflow is registered for Studio", () => {
  assert.ok(mastra.getWorkflow("conversationalPartyWorkflow"));
});

test("read-only Silpo alternative tools are registered for Studio", () => {
  assert.ok(mastra.getTool("silpoGetSimilarProducts"));
  assert.ok(mastra.getTool("silpoGetReplacements"));
});
