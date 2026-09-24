type EventGuidanceInput = {
  message: string;
  participantCount: number;
  hasCurrentPlan: boolean;
};

const corporateEvent = /corporate|business|office|work(?:place)?|team\s*(?:event|party)|корпоратив|офіс|робоч(?:а|ий|е|і)/iu;
const outdoorCookingEvent = /barbecue|barbeque|bbq|grill|picnic|cookout|шашлик|барбекю|грил|пікнік/iu;

/** Grounds autonomous planning in this party's event brief instead of a generic menu default. */
export function eventPlanningGuidance({ message, participantCount, hasCurrentPlan }: EventGuidanceInput) {
  const rules = [
    "The current message is the event brief. Use only this message, the supplied current party, and the supplied current plan; never reuse a menu, theme, dish, or preference from another party or an earlier run.",
    "Treat the named occasion and setting as hard suitability constraints. Choose a coherent menu that fits them, not merely any main + side + drink + sauce combination.",
  ];

  if (!hasCurrentPlan) rules.push("This party has no existing plan, so plan it independently from a clean slate.");
  if (!outdoorCookingEvent.test(message)) {
    rules.push("Do not default to barbecue, shashlik, grilled food, picnic food, or barbecue-specific sides and sauces unless this current message explicitly requests or implies an outdoor/grill occasion.");
  }
  if (corporateEvent.test(message)) {
    rules.push("For this corporate/office occasion, prefer neat, easy-to-serve individual or shareable food suitable for a workplace, plus non-alcoholic drinks; avoid messy outdoor-cooking dishes unless explicitly requested.");
  }
  if (participantCount === 1) {
    rules.push("This is for one participant: keep the menu compact, avoid redundant varieties and party-size excess, and buy the smallest sufficient increments.");
  }

  return rules.join(" ");
}
