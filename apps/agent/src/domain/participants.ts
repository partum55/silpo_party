const participantWords = new Map<string, number>([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["одного", 1], ["одну", 1], ["двох", 2], ["трьох", 3], ["чотирьох", 4],
  ["п'ятьох", 5], ["п’ятьох", 5], ["шістьох", 6], ["сімох", 7], ["вісьмох", 8],
  ["дев'ятьох", 9], ["дев’ятьох", 9], ["десятьох", 10],
]);

/** Extracts an explicitly phrased event headcount without mistaking product quantities for people. */
export function mentionedParticipantCount(message: string): number | null {
  const token = String.raw`(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|одного|одну|двох|трьох|чотирьох|п['’]ятьох|шістьох|сімох|вісьмох|дев['’]ятьох|десятьох)`;
  const contextual = new RegExp(String.raw`(?:^|\s)(?:for|на|для)\s+(${token})(?=\s*(?:$|[,.;!?]|а(?:\s|$)|і(?:\s|$)|й(?:\s|$)|та(?:\s|$)|people(?:\s|$)|persons?(?:\s|$)|guests?(?:\s|$)|люд(?:ей|ини)(?:\s|$)|ос(?:іб|обу)(?:\s|$)|учасник(?:ів|и)?(?:\s|$)))`, "iu");
  const suffixed = new RegExp(String.raw`(${token})\s*(?:people|persons?|guests?|людей|особи|осіб|учасники|учасників)(?=\s|$|[,.;!?])`, "iu");
  const match = message.match(contextual) ?? message.match(suffixed);
  if (!match) return null;
  const normalized = match[1].toLocaleLowerCase("uk");
  const numeric = Number(normalized);
  return Number.isInteger(numeric) ? numeric : (participantWords.get(normalized) ?? null);
}

