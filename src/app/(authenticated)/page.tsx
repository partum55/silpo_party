import Link from "next/link";

import { SCENARIOS } from "@/demo/scenarios";
import { DEMO_ONLY } from "@/demo/copy";
import { MODE_COPY } from "@/lib/party/mode-copy";
import { SubmitButton } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ModeCardPicker } from "@/components/ui/mode-card";
import { ModeDot } from "@/components/ui/mode-badge";
import { Money } from "@/components/ui/money";
import { Panel } from "@/components/ui/panel";

const MAX_ACTIVE_PARTIES = 5;

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col sm:max-w-[30rem] md:max-w-[34rem]">
      <header className="px-5 pb-2 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <p className="text-sm text-ink-soft">Привіт, Назар</p>
        <h1 className="text-2xl font-semibold tracking-tight">Ваші вечірки</h1>
      </header>

      <main className="flex-1 space-y-6 px-5 pb-10">
        <InlineAlert tone="info">
          Це демо без входу та ШІ: відповіді агента заздалегідь підготовлені, а ціни — приклад. Відкрийте одну з вечірок нижче.
        </InlineAlert>

        <Panel className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-medium">Створити вечірку</h2>
            <p className="text-xs text-ink-soft">
              Активні вечірки: {SCENARIOS.length} із {MAX_ACTIVE_PARTIES}
            </p>
          </div>
          <form noValidate title={DEMO_ONLY}>
            <fieldset disabled className="space-y-3 opacity-60">
              <input
                name="name"
                placeholder="Назва вечірки"
                className="w-full rounded-[var(--radius-md)] border border-stone bg-paper px-3 py-2.5 text-[0.95rem] placeholder:text-stone-600"
              />
              <ModeCardPicker name="mode" defaultValue="EVENT" />
              <input
                name="budgetUah"
                type="number"
                placeholder="Бюджет, грн (необов'язково)"
                className="w-full rounded-[var(--radius-md)] border border-stone bg-paper px-3 py-2.5 text-[0.95rem] placeholder:text-stone-600"
              />
              <SubmitButton disabled className="w-full">Створити вечірку</SubmitButton>
            </fieldset>
          </form>
        </Panel>

        <details className="group rounded-[var(--radius-md)] border border-stone px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm text-ink-soft [&::-webkit-details-marker]:hidden">
            <span>Отримали код запрошення, а не посилання?</span>
            <span className="text-xs transition-transform group-open:rotate-180">▾</span>
          </summary>
          <form noValidate title={DEMO_ONLY} className="mt-3">
            <fieldset disabled className="flex gap-2 opacity-60">
              <input
                name="joinCode"
                placeholder="Код або посилання-запрошення"
                className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-stone bg-paper px-3 py-2.5 text-[0.95rem] placeholder:text-stone-600"
              />
              <SubmitButton variant="secondary" disabled>Увійти</SubmitButton>
            </fieldset>
          </form>
        </details>

        <section className="space-y-3">
          <h2 className="font-medium">Мої вечірки</h2>
          <ul className="space-y-2">
            {SCENARIOS.map((party) => (
              <li key={party.id}>
                <Link
                  href={`/parties/${party.id}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-stone bg-paper-raised px-4 py-3 transition-colors hover:border-ink-soft/50"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ModeDot mode={party.mode} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{party.name}</span>
                      <span className="block text-xs text-ink-soft">
                        {MODE_COPY[party.mode].label} · Ви організатор · триває
                      </span>
                    </span>
                  </span>
                  {party.budget != null && <Money amount={party.budget} className="shrink-0 text-sm text-ink-soft" />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
