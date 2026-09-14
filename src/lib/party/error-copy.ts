/** Plain-Ukrainian text for every `?error=` code the app can redirect with — RuleError codes plus form-level ones. */
const ERROR_COPY: Record<string, string> = {
  name_required: "Вкажіть назву вечірки.",
  invalid_budget: "Бюджет має бути додатним числом.",
  join_code_required: "Введіть код запрошення.",
  not_found: "Таку вечірку не знайдено.",
  not_member: "Ви не берете участі в цій вечірці.",
  not_creator: "Цю дію може виконати лише організатор.",
  party_completed: "Вечірку вже завершено.",
  already_member: "Ви вже приєднані до цієї вечірки.",
  party_full: "У вечірці вже максимум учасників (10).",
  too_many_active_parties: "У вас вже дві активні вечірки — завершіть або видаліть одну, щоб створити нову.",
  creator_must_delete_not_leave: "Організатор не може покинути вечірку — лише видалити її.",
  member_marked_ready: "Зніміть позначку «Готовий(-а)», щоб писати повідомлення.",
};

export function errorMessage(code: string): string {
  return ERROR_COPY[code] ?? "Щось пішло не так. Спробуйте ще раз.";
}
