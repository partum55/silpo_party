/**
 * Quality checks against the real model and the real Silpo catalog. Not part of `npm test` (slow, costs tokens,
 * needs credentials). Run before changing a prompt or a model setting:
 *
 *   EVAL_SILPO_USER_ID=<a user id with a Silpo connection> npm --workspace packages/agent run eval
 *
 * Reads the repository's .env.local (AI_API_KEY, Supabase and SILPO_CREDENTIALS_KEY for the Silpo connection).
 * Prints one line per case and exits with 1 if any case fails.
 */
import { fileURLToPath } from "node:url";

process.loadEnvFile(fileURLToPath(new URL("../../../.env.local", import.meta.url)));
process.env.SILPO_CACHE_DISABLED = "1";

const { turnInputSchema } = await import("../src/domain/contract.ts");
const { productRestrictionSafety } = await import("../src/domain/restrictions.ts");
const { createDeepSeekLlm } = await import("../src/llm/llm.ts");
const { routeMessage } = await import("../src/scenarios/router.ts");
const { withCatalogSession } = await import("../src/silpo/catalog.ts");
const { runTurn } = await import("../src/turn/run-turn.ts");

type Route = NonNullable<Awaited<ReturnType<typeof routeMessage>>>;
type TurnResult = Awaited<ReturnType<typeof runTurn>>;

const apiKey = process.env.AI_API_KEY;
const silpoUserId = process.env.EVAL_SILPO_USER_ID;
if (!apiKey) throw new Error("AI_API_KEY is missing from .env.local.");
const llm = createDeepSeekLlm({ apiKey });

function planRow(id: string, name: string) {
  return {
    id, lookupProductId: id, name, priceUah: 50, unit: "шт", available: true, category: "food" as const,
    packageSize: { amount: 1, unit: "piece" as const }, metadata: { ingredients: [], allergens: [], labels: [] },
    quantity: 1, assignedMemberIds: ["anna"], reason: "Запит учасника.", lineTotalUah: 50,
  };
}
const plan = (...rows: Array<ReturnType<typeof planRow>>) => ({ products: rows, recipes: [], totalUah: rows.length * 50, excludedIngredientKeys: [] });

const routeInput = (message: string, extra: Record<string, unknown> = {}) =>
  turnInputSchema.parse({ message, mode: "SHOPPING", actorId: "anna", members: [{ id: "anna" }], ...extra });

type Case = { name: string; run: () => Promise<string | null> };
const check = (ok: boolean, detail: string) => ok ? null : detail;
const opsOf = (route: Route | null) => JSON.stringify(route?.productOps.map((op) => ({ action: op.action, target: op.target, query: op.query, brand: op.brand })) ?? route);

const routeCases: Case[] = [
  {
    name: "заміна — одна операція з новим брендом",
    run: async () => {
      const route = await routeMessage(routeInput("заміни гель для душу на old spice", { plan: plan(planRow("p2", "Гель для душу Palmolive з ожиною")) }), llm);
      const ops = route?.productOps ?? [];
      return check(ops.length === 1 && ops[0].action === "replace" && /old spice/i.test(ops[0].query) && ops[0].brand === "Old Spice", opsOf(route));
    },
  },
  {
    name: "«поміняй назад» з історією чату",
    run: async () => {
      const route = await routeMessage(routeInput("поміняй назад", {
        plan: plan(planRow("p2", "Напій Coca-Cola 1 л")),
        recentMessages: [
          { from: "member", memberId: "anna", text: "поміняй лимонад на колу" },
          { from: "agent", text: "Прибрано:\n• «Напій Geo Natura Лимонад крем-сода»\n\nДодано:\n• «Напій Coca-Cola 1 л» ×6" },
        ],
      }), llm);
      const op = route?.productOps[0];
      return check(op?.action === "replace" && /лимонад/i.test(op.query), opsOf(route));
    },
  },
  {
    name: "бренд кирилицею: «мілку» — Milka",
    run: async () => {
      const route = await routeMessage(routeInput("додай мілку з малиною"), llm);
      return check(route?.productOps[0]?.brand === "Milka", opsOf(route));
    },
  },
  {
    name: "бренд у відмінку: «моршинську»",
    run: async () => {
      const route = await routeMessage(routeInput("хочу моршинську негазовану"), llm);
      return check(/моршинськ/i.test(route?.productOps[0]?.brand ?? ""), opsOf(route));
    },
  },
  {
    name: "без названого бренду — brand null",
    run: async () => {
      const route = await routeMessage(routeInput("купи колу і молоко"), llm);
      const ops = route?.productOps ?? [];
      return check(ops.length === 2 && ops.every((op) => op.brand === null), opsOf(route));
    },
  },
  {
    name: "«щось для шашлику» — кілька товарів",
    run: async () => {
      const route = await routeMessage(routeInput("Я б дуже хотів приготувати шашлики, додай мені якихось інгредієнтів"), llm);
      return check((route?.productOps.length ?? 0) >= 3, opsOf(route));
    },
  },
  {
    name: "прибрати наявний товар",
    run: async () => {
      const route = await routeMessage(routeInput("прибери кетчуп", { plan: plan(planRow("p3", "Кетчуп Ascania Лагідний")) }), llm);
      return check(route?.productOps[0]?.action === "remove", opsOf(route));
    },
  },
  {
    name: "питання про план",
    run: async () => check((await routeMessage(routeInput("скільки я винен?"), llm))?.kind === "question", "not a question"),
  },
  {
    name: "не за темою",
    run: async () => check((await routeMessage(routeInput("розв'яжи рівняння x^2 = 4"), llm))?.kind === "off_topic", "not off_topic"),
  },
  {
    name: "вечеря: страва стає dishOps",
    run: async () => {
      const route = await routeMessage(routeInput("хочу приготувати борщ", { mode: "DINNER" }), llm);
      return check(route?.dishOps[0]?.action === "add" && /борщ/i.test(route.dishOps[0].dish), JSON.stringify(route));
    },
  },
  {
    name: "вечеря: зміна порцій іде в servings рецепта, а не кількість товарів",
    run: async () => {
      const borscht = { title: "Борщ", dishKey: "борщ", source: "generated", sourceUrl: null, baseServings: 4, servings: 1, assignedMemberIds: ["anna"], ingredients: [], missingIngredients: [], steps: ["Зварити."] };
      const route = await routeMessage(routeInput("на 2 порції збільш", {
        mode: "DINNER",
        members: [{ id: "anna", wishes: [{ id: "w1", text: "борщ", fulfillmentStrategy: "recipe" }] }],
        plan: { ...plan(planRow("p4", "Перець Верес солодкий стерилізований с/б")), recipes: [borscht] },
      }), llm);
      return check(Boolean(route?.dishOps[0]?.servings) && !route?.productOps.some((op) => op.action === "set_quantity"), JSON.stringify(route));
    },
  },
  {
    name: "подія: опис події стає planEvent",
    run: async () => check(Boolean((await routeMessage(routeInput("сплануй шашлики на 6", { mode: "EVENT" }), llm))?.planEvent), "no planEvent"),
  },
];

const turn = (message: string, foodRestrictions?: (id: string) => Promise<string[]>, mode: "SHOPPING" | "DINNER" | "EVENT" = "SHOPPING") => runTurn(
  { message, mode, actorId: silpoUserId, members: [{ id: silpoUserId }] },
  { llm, withSession: (operation) => withCatalogSession(silpoUserId!, operation), foodRestrictions },
);
const added = (result: TurnResult) => result.reply.kind === "changes" ? result.reply.report.added.map(({ product }) => product) : [];
const unresolved = (result: TurnResult) => result.reply.kind === "changes" ? result.reply.report.unresolved : [];
const addedNames = (result: TurnResult) => added(result).map((product) => product.name).join(" | ") || JSON.stringify(unresolved(result));

const turnCases: Case[] = [
  { name: "бренд: Old Spice", run: async () => { const result = await turn("додай гель для душу old spice"); return check(added(result).some((p) => /old spice/i.test(p.name)), addedNames(result)); } },
  { name: "бренд кирилицею: Milka", run: async () => { const result = await turn("додай мілку з малиною"); return check(added(result).some((p) => /milka/i.test(p.name)), addedNames(result)); } },
  {
    name: "відсутній бренд не підміняється іншим",
    run: async () => {
      const result = await turn("додай шоколад hershey's");
      return check(!added(result).length && ["no_brand", "no_results"].includes(unresolved(result)[0]?.reason ?? ""), addedNames(result));
    },
  },
  { name: "«шампури» — не шампунь", run: async () => { const result = await turn("додай шампури"); return check(!added(result).some((p) => /шампун/i.test(p.name)), addedNames(result)); } },
  { name: "картопля — не чипси", run: async () => { const result = await turn("додай 2 кг картоплі"); return check(added(result).some((p) => /картопл/i.test(p.name) && !/чипс/i.test(p.name)), addedNames(result)); } },
  {
    name: "вечеря: рецепт борщу з інгредієнтами з каталогу",
    run: async () => {
      const result = await turn("хочу приготувати борщ", undefined, "DINNER");
      const recipes = result.reply.kind === "changes" ? result.reply.report.recipes : [];
      return check(recipes.length === 1 && added(result).length >= 4, `${recipes.length} recipes; ${addedNames(result)}`);
    },
  },
  {
    name: "подія: пікнік на 6 у межах бюджету ходу",
    run: async () => {
      const result = await runTurn(
        { message: "сплануй пікнік на 6 людей", mode: "EVENT", actorId: silpoUserId, members: [{ id: silpoUserId }], budgetUah: 2500 },
        { llm, withSession: (operation) => withCatalogSession(silpoUserId!, operation) },
      );
      return check(added(result).length >= 6 && result.plan.totalUah <= 2500, `${added(result).length} items, ${result.plan.totalUah} грн`);
    },
  },
  {
    name: "обмеження: без горіхів",
    run: async () => {
      const result = await turn("додай печиво і шоколад", async () => ["горіхи"]);
      const unsafe = added(result).filter((product) => productRestrictionSafety(product, ["горіхи"]) === "unsafe");
      return check(added(result).length > 0 && !unsafe.length, addedNames(result));
    },
  },
];

let failed = 0;
async function runCases(title: string, cases: Case[]) {
  console.log(`\n${title}`);
  for (const { name, run } of cases) {
    const started = Date.now();
    let problem: string | null;
    try { problem = await run(); } catch (error) { problem = error instanceof Error ? error.message : String(error); }
    if (problem) failed += 1;
    console.log(`${problem ? "✗" : "✓"} ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)${problem ? `\n    ${problem}` : ""}`);
  }
}

await runCases("Розбір повідомлень", routeCases);
if (silpoUserId) await runCases("Повний хід на каталозі Сільпо", turnCases);
else console.log("\nПовний хід пропущено: задайте EVAL_SILPO_USER_ID.");
console.log(`\n${failed ? `${failed} не пройдено` : "усе пройдено"}`);
process.exit(failed ? 1 : 0);
