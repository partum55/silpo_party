import { Mastra } from "@mastra/core/mastra";

import { partyPlannerAgent } from "./party-planner-agent.ts";
import { partyPlanningWorkflow } from "./party-planning-workflow.ts";
import { silpoGetProductDetails, silpoSearchProducts } from "./tools/silpo-tools.ts";

export const mastra = new Mastra({
  agents: { partyPlannerAgent },
  workflows: { partyPlanningWorkflow },
  tools: { silpoSearchProducts, silpoGetProductDetails },
});
