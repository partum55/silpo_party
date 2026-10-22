import type { PackageSize } from "@/lib/cart/display";
import type { PartyMode } from "@/lib/party/mode-copy";
import type { ChatMessage, Member, Recipe } from "@/components/party/types";

// Everything the demo shows is hand-written: no agent, no Silpo catalog. Prices and products are plausible, not live.

export const ME = "me";

/** A cart line before quantity edits. `payers` are the members who split its cost. */
export type Seed = { id: string; name: string; price: number; pack: PackageSize; qty: number; payers: string[] };

/** One scripted exchange: `from` "writes" `prompt`, the agent answers with `reply` and fills the cart. */
export type Step = { from: string; prompt: string; reply: string; items: Seed[]; recipes?: Recipe[] };

export type Scenario = {
  id: string;
  name: string;
  blurb: string;
  mode: PartyMode;
  budget: number | null;
  members: Member[];
  messages: ChatMessage[];
  steps: Step[];
};

const seed = (id: string, name: string, price: number, amount: number, unit: PackageSize["unit"], qty: number, payers: string[]): Seed => ({
  id, name, price, pack: { amount, unit }, qty, payers,
});

const member = (user_id: string, name: string, wishes: string[] = []): Member => ({
  user_id,
  role: user_id === ME ? "CREATOR" : "MEMBER",
  joined_at: "2026-10-20T10:00:00Z",
  name,
  avatarUrl: null,
  wishes: wishes.map((text, index) => ({ id: `${user_id}-w${index}`, text, fulfillmentStrategy: "either" as const })),
  ready: false,
});

const message = (id: string, sender_type: ChatMessage["sender_type"], content: string, sender_user_id: string | null = null): ChatMessage => ({
  id, sender_type, sender_user_id, content, reply_to_message_id: null, created_at: "2026-10-20T10:00:00Z",
});

/** [name, needed, unit, packs bought, product, pack amount] */
type Ing = [string, number, PackageSize["unit"], number, string, number];
const recipe = (title: string, steps: string[], cost_uah: number, ingredients: Ing[]): Recipe => ({
  title,
  sourceUrl: null,
  steps,
  assignedMemberIds: [],
  cost_uah,
  ingredients: ingredients.map(([name, requiredAmount, unit, purchaseQuantity, product, packAmount]) => ({
    name: `${name} — ${requiredAmount} ${unit === "g" ? "г" : unit === "ml" ? "мл" : "шт"}`,
    requiredAmount,
    unit,
    purchaseQuantity,
    purchasedAmount: purchaseQuantity * packAmount,
    selectedProduct: { name: product, packageSize: { amount: packAmount, unit } },
  })),
});

const everyone = (members: Member[]) => members.map((m) => m.user_id);

const eventMembers = [
  member(ME, "Назар"),
  member("olya", "Оля", ["не їм свинину"]),
  member("max", "Макс", ["потрібні вегетаріанські опції"]),
  member("daryna", "Дарина"),
];
const eventAll = everyone(eventMembers);

const dinnerMembers = [member(ME, "Назар"), member("sonya", "Соня", ["хочу щось легке на десерт"]), member("bohdan", "Богдан")];
const dinnerAll = everyone(dinnerMembers);

const shoppingMembers = [member(ME, "Назар"), member("olya", "Оля")];

const carbonara = recipe(
  "Паста карбонара",
  [
    "Відваріть спагеті в підсоленій воді до al dente, залиште склянку води з-під пасти.",
    "Наріжте бекон і обсмажте до хрусткості без олії.",
    "Збийте яйця та жовтки з натертим пармезаном, додайте багато чорного перцю.",
    "Змішайте гарячу пасту з беконом, зніміть із вогню й влийте яєчну суміш, розводячи водою з-під пасти до кремової текстури.",
    "Подавайте одразу, посипавши пармезаном.",
  ],
  432.5,
  [
    ["Спагеті", 400, "g", 1, "Спагеті, 500 г", 500],
    ["Бекон", 200, "g", 1, "Бекон нарізка, 200 г", 200],
    ["Яйця", 5, "piece", 1, "Яйця курячі С1, 10 шт", 10],
    ["Пармезан", 80, "g", 1, "Сир Пармезан, 150 г", 150],
    ["Чорний перець", 5, "g", 1, "Перець чорний мелений, 30 г", 30],
  ],
);

const tiramisu = recipe(
  "Тірамісу",
  [
    "Відділіть жовтки від білків, збийте жовтки з цукром до світлої маси.",
    "Додайте маскарпоне й обережно змішайте до однорідного крему.",
    "Швидко вмочіть савоярді в охолоджену каву й викладіть шаром у форму.",
    "Покрийте кремом, повторіть шари, накрийте плівкою й охолоджуйте щонайменше 4 години.",
    "Перед подачею посипте какао.",
  ],
  529.5,
  [
    ["Маскарпоне", 500, "g", 2, "Сир Маскарпоне, 250 г", 250],
    ["Савоярді", 200, "g", 1, "Печиво Савоярді, 200 г", 200],
    ["Жовтки", 4, "piece", 0, "Яйця курячі С1, 10 шт (вже в списку)", 10],
    ["Кава мелена", 25, "g", 1, "Кава мелена, 250 г", 250],
    ["Какао", 20, "g", 1, "Какао-порошок, 100 г", 100],
  ],
);

export const SCENARIOS: Scenario[] = [
  {
    id: "kebab",
    name: "Шашлики на дачі",
    blurb: "Подія: агент сам збирає м'ясо, овочі, напої й ділить суму порівну.",
    mode: "EVENT",
    budget: 2500,
    members: eventMembers,
    messages: [
      message("m1", "SYSTEM", "Назар створив(-ла) вечірку"),
      message("m2", "USER", "Я не їм свинину, якщо що 🙂", "olya"),
      message("m3", "AGENT", "Привіт! Я врахував побажання Олі. Опишіть подію — і я складу кошик."),
    ],
    steps: [
      {
        from: ME,
        prompt: "Заплануй шашлики з друзями на 6 осіб",
        reply:
          "Склав план на 6 осіб (≈ 200 г м'яса на людину + гарнір). Оля не їсть свинину, тож основа — курячі стегна й яловичина. " +
          "Для Макса додав печериці та овочі на гриль. Вартість ділиться порівну між усіма учасниками — деталі на вкладці «План».",
        items: [
          seed("k1", "Стегна курячі охолоджені, 1 кг", 139.9, 1000, "g", 2, eventAll),
          seed("k2", "Лопатка яловича охолоджена, 1 кг", 289, 1000, "g", 1, eventAll),
          seed("k3", "Печериці, 500 г", 79.9, 500, "g", 1, eventAll),
          seed("k4", "Кабачки, 1 кг", 39.9, 1000, "g", 1, eventAll),
          seed("k5", "Перець червоний солодкий, 1 кг", 89.9, 1000, "g", 1, eventAll),
          seed("k6", "Цибуля ріпчаста, 1 кг", 24.9, 1000, "g", 1, eventAll),
          seed("k7", "Лаваш вірменський, 2 шт", 29.9, 2, "piece", 2, eventAll),
          seed("k8", "Кетчуп до шашликів, 450 г", 54.9, 450, "g", 1, eventAll),
          seed("k9", "Вугілля деревне, 3 кг", 119, 3000, "g", 1, eventAll),
        ],
      },
      {
        from: ME,
        prompt: "Додай напоїв і щось солодке",
        reply: "Додав воду, сік і лимонад з розрахунку ≈ 1,5 л на людину, а на десерт — кавун і маршмелоу для смаження на вогні.",
        items: [
          seed("k10", "Вода мінеральна негазована, 1,5 л", 28.9, 1500, "ml", 6, eventAll),
          seed("k11", "Сік яблучний, 1 л", 52.9, 1000, "ml", 2, eventAll),
          seed("k12", "Напій газований Кола, 2 л", 64.9, 2000, "ml", 2, eventAll),
          seed("k13", "Кавун, 1 кг", 18.9, 1000, "g", 5, eventAll),
          seed("k14", "Маршмелоу для смаження, 150 г", 62.9, 150, "g", 2, eventAll),
        ],
      },
    ],
  },
  {
    id: "dinner",
    name: "Італійська вечеря",
    blurb: "Вечеря: агент підбирає рецепти й об'єднує інгредієнти в один список покупок.",
    mode: "DINNER",
    budget: 1200,
    members: dinnerMembers,
    messages: [
      message("m1", "SYSTEM", "Назар створив(-ла) вечірку"),
      message("m2", "AGENT", "Привіт! Пропонуйте страви — я підберу рецепти й складу список покупок."),
    ],
    steps: [
      {
        from: ME,
        prompt: "Хочу приготувати пасту карбонару",
        reply:
          "Додав карбонару на 4 порції. Сіль та олію вважаю домашніми запасами, решту інгредієнтів знайшов у Сільпо й додав до списку покупок.\n\n" +
          "Рецепт «Паста карбонара» (4 порції):\n" +
          "Інгредієнти: • Спагеті — 400 г • Бекон — 200 г • Яйця — 3 шт + 2 жовтки • Пармезан — 80 г • Чорний перець — за смаком\n" +
          "Приготування: " + carbonara.steps.map((step, index) => `${index + 1}. ${step}`).join(" "),
        items: [
          seed("d1", "Спагеті, 500 г", 42.9, 500, "g", 1, dinnerAll),
          seed("d2", "Бекон нарізка, 200 г", 109.9, 200, "g", 1, dinnerAll),
          seed("d3", "Яйця курячі С1, 10 шт", 69.9, 10, "piece", 1, dinnerAll),
          seed("d4", "Сир Пармезан, 150 г", 169.9, 150, "g", 1, dinnerAll),
          seed("d5", "Перець чорний мелений, 30 г", 39.9, 30, "g", 1, dinnerAll),
        ],
        recipes: [carbonara],
      },
      {
        from: "sonya",
        prompt: "Додай тірамісу на десерт, щось легке",
        reply:
          "Тірамісу — класичний варіант без випікання. Яєць з першої упаковки вистачить на обидві страви, тому нових не додавав.\n\n" +
          "Рецепт «Тірамісу» (6 порцій):\n" +
          "Інгредієнти: • Маскарпоне — 500 г • Савоярді — 200 г • Жовтки — 4 шт • Міцна кава — 250 мл • Какао — 2 ст. л. • Цукор — 80 г\n" +
          "Приготування: " + tiramisu.steps.map((step, index) => `${index + 1}. ${step}`).join(" "),
        items: [
          seed("d6", "Сир Маскарпоне, 250 г", 129.9, 250, "g", 2, dinnerAll),
          seed("d7", "Печиво Савоярді, 200 г", 69.9, 200, "g", 1, dinnerAll),
          seed("d8", "Кава мелена, 250 г", 139.9, 250, "g", 1, dinnerAll),
          seed("d9", "Какао-порошок, 100 г", 59.9, 100, "g", 1, dinnerAll),
        ],
        recipes: [tiramisu],
      },
    ],
  },
  {
    id: "weekly",
    name: "Закупка на тиждень",
    blurb: "Закупка: кожен просить своє, а платить той, хто просив.",
    mode: "SHOPPING",
    budget: null,
    members: shoppingMembers,
    messages: [
      message("m1", "SYSTEM", "Назар створив(-ла) вечірку"),
      message("m2", "AGENT", "Привіт! Кажіть, що додати — я розподілю товари між тими, хто просив."),
    ],
    steps: [
      {
        from: ME,
        prompt: "Додай мені молоко і хліб",
        reply: "Додав молоко 2,5% (2 пакети) і хліб — це ваші товари, платите ви.",
        items: [
          seed("s1", "Молоко 2,5%, 900 мл", 41.9, 900, "ml", 2, [ME]),
          seed("s2", "Хліб Київський, 700 г", 38.5, 700, "g", 1, [ME]),
        ],
      },
      {
        from: "olya",
        prompt: "Додай мені кефір, сир кисломолочний і авокадо",
        reply: "Додав кефір, кисломолочний сир і два авокадо. Ці товари оплачує Оля.",
        items: [
          seed("s3", "Кефір 1%, 900 г", 44.9, 900, "g", 1, ["olya"]),
          seed("s4", "Сир кисломолочний 5%, 350 г", 69.9, 350, "g", 1, ["olya"]),
          seed("s5", "Авокадо Хасс, 1 шт", 59.9, 1, "piece", 2, ["olya"]),
        ],
      },
      {
        from: ME,
        prompt: "Додай яйця, беремо навпіл з Олею",
        reply: "Додав яйця й записав оплату на вас обох — вартість поділена порівну.",
        items: [seed("s6", "Яйця курячі С1, 10 шт", 64.9, 10, "piece", 1, [ME, "olya"])],
      },
    ],
  },
];

export const findScenario = (id: string) => SCENARIOS.find((scenario) => scenario.id === id);
