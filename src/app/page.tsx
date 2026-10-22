import Link from "next/link";

import { ModeDot } from "@/components/ui/mode-badge";
import { Money } from "@/components/ui/money";
import { Panel } from "@/components/ui/panel";
import { SCENARIOS } from "@/demo/scenarios";
import { MODE_COPY } from "@/lib/party/mode-copy";

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col sm:max-w-[30rem] md:max-w-[34rem]">
      <header className="px-5 pb-2 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <p className="text-sm text-ink-soft">Silpo Party · демо</p>
        <h1 className="text-2xl font-semibold tracking-tight">Оберіть вечірку</h1>
      </header>

      <main className="flex-1 space-y-6 px-5 pb-10">
        <Panel className="space-y-2 text-sm text-ink-soft">
          <p>
            Silpo Party перетворює розмову компанії на кошик у Сільпо: агент підбирає товари, враховує обмеження в їжі й
            ділить вартість.
          </p>
          <p>
            Це демо без входу та ШІ: відповіді агента заздалегідь підготовлені, ціни й товари — приклад. Натискайте
            підказки в чаті та правте кошик на вкладці «План».
          </p>
        </Panel>

        <ul className="space-y-2">
          {SCENARIOS.map((scenario) => (
            <li key={scenario.id}>
              <Link
                href={`/parties/${scenario.id}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-stone bg-paper-raised px-4 py-3 transition-colors hover:border-ink-soft/50"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <ModeDot mode={scenario.mode} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{scenario.name}</span>
                    <span className="block text-xs text-ink-soft">
                      {MODE_COPY[scenario.mode].label} · {scenario.blurb}
                    </span>
                  </span>
                </span>
                {scenario.budget != null && <Money amount={scenario.budget} className="shrink-0 text-sm text-ink-soft" />}
              </Link>
            </li>
          ))}
        </ul>

        <p className="text-center text-xs text-ink-soft">
          <a className="underline underline-offset-2" href="https://youtu.be/jMavh8r14cQ" target="_blank" rel="noopener noreferrer">
            Відео-презентація
          </a>
          {" · "}
          <a className="underline underline-offset-2" href="https://www.silpoparty.app" target="_blank" rel="noopener noreferrer">
            Повна версія
          </a>
        </p>
      </main>
    </div>
  );
}
