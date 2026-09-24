/**
 * Pantry staples every household already has. Dinner planning never buys them. Matching is stem-based so
 * "сіль кухонна", "олія соняшникова", or "перець чорний мелений" are recognised, while produce that shares a
 * word (bell pepper, sparkling water as a drink request) is not.
 */
const staplePatterns: RegExp[] = [
  /^(?:морськ\S* |кухонн\S* |йодован\S* )?сіл[ья](?: .*)?$/u,
  /^(?:чорн\S* |мелен\S* |духмян\S* )*перець(?: (?:чорн|мелен|горошк|духмян)\S*)*$/u,
  /^(?:питн\S* |кип['’]?ячен\S* |холодн\S* |гаряч\S* |тепл\S* )?вод[аиу](?: (?:питн|кип['’]?ячен|холодн|гаряч|тепл|з-під)\S*)*$/u,
  /^(?:соняшников\S* |рослинн\S* |оливков\S* |рафінован\S* )*олі[яї](?: .*)?$/u,
  /^(?:столов\S* |яблучн\S* |винн\S* )?оц(?:ет|ту|том)(?: .*)?$/u,
  /^(?:білий |коричнев\S* )?цук(?:ор|ру)(?: (?:білий|пісок|коричнев\S*))?$/u,
  /^(?:харчов\S* )?сода(?: харчов\S*)?$/u,
  /^лаврови[йх]? лист\S*$/u,
  /^(?:спеці[їя]|приправ\S*|сухі трави|сушені трави)(?: .*)?$/u,
  /^(?:sea |table |kosher )?salt$/,
  /^(?:black |ground )*pepper(?: \(ground\))?$/,
  /^(?:tap |cold |warm |hot |boiling )?water$/,
  /^(?:olive |vegetable |sunflower |cooking )?oil$/,
  /^(?:white )?sugar$/,
  /^(?:white |apple cider )?vinegar$/,
  /^(?:baking )?soda$/,
  /^bay leaf$/,
];

export function isPantryStaple(name: string) {
  const normalized = name.trim().toLocaleLowerCase("uk").replace(/\s+/g, " ").replace(/[.,;:!]+$/u, "");
  return staplePatterns.some((pattern) => pattern.test(normalized));
}
