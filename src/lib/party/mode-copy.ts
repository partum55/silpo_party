export type PartyMode = "SHOPPING" | "DINNER" | "EVENT";

export type ModeAccent = "tomato" | "butter" | "plum";

/**
 * Single source of truth for how each party mode is described anywhere in the UI — the mode picker, party
 * badges, chat placeholders. Previously duplicated (and drifted) between the create-party form and PartyLive.
 */
export const MODE_COPY: Record<
  PartyMode,
  { label: string; short: string; description: string; example: string; placeholder: string; accent: ModeAccent }
> = {
  SHOPPING: {
    label: "Закупка",
    short: "Купуємо потрібне",
    description: "Кожен просить свої товари — агент додає їх у спільний кошик, і платить за них саме той, хто просив.",
    example: "Додай мені молоко і хліб",
    placeholder: "Наприклад: додай мені молоко і хліб",
    accent: "tomato",
  },
  DINNER: {
    label: "Вечеря",
    short: "Готуємо разом",
    description: "Пропонуйте страви — агент підбирає рецепти, об'єднує інгредієнти в один список покупок і ділить вартість.",
    example: "Хочу приготувати пасту карбонару",
    placeholder: "Наприклад: хочу приготувати пасту карбонару",
    accent: "butter",
  },
  EVENT: {
    label: "Подія",
    short: "Плануємо все разом",
    description: "Опишіть подію — агент самостійно підбере основну їжу, закуски й напої, а вартість ділиться порівну.",
    example: "Заплануй шашлики з друзями на 6 осіб",
    placeholder: "Наприклад: заплануй шашлики з друзями на 6",
    accent: "plum",
  },
};

export const MODE_ORDER: PartyMode[] = ["SHOPPING", "DINNER", "EVENT"];
