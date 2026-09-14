import assert from "node:assert/strict";
import test from "node:test";

import { eventPlanningGuidance } from "../src/domain/event-guidance.ts";

test("a fresh corporate event is independent and excludes an unsupported barbecue default", () => {
  const guidance = eventPlanningGuidance({
    message: "сплануй корпоративну вечірку на одного",
    participantCount: 1,
    hasCurrentPlan: false,
  });

  assert.match(guidance, /clean slate/i);
  assert.match(guidance, /corporate\/office/i);
  assert.match(guidance, /Do not default to barbecue/i);
  assert.match(guidance, /one participant/i);
});

test("an explicitly requested barbecue is not prohibited", () => {
  const guidance = eventPlanningGuidance({
    message: "Хочу запланувати шашлики на трьох",
    participantCount: 3,
    hasCurrentPlan: false,
  });

  assert.doesNotMatch(guidance, /Do not default to barbecue/i);
});
