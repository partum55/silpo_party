import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { isSilpoConnected } from "@/lib/silpo/connection";
import { listMyParties } from "@/lib/party/service";
import { errorMessage } from "@/lib/party/error-copy";
import { PENDING_JOIN_COOKIE } from "@/lib/party/join-code";
import type { PartyMode } from "@/lib/party/mode-copy";

import { createPartyAction, joinPartyAction } from "./parties/actions";
import { SubmitButton } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ModeCardPicker } from "@/components/ui/mode-card";
import { ModeDot } from "@/components/ui/mode-badge";
import { Money } from "@/components/ui/money";
import { Panel } from "@/components/ui/panel";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  if (!(await isSilpoConnected(user.id))) redirect("/connect-silpo");

  // Someone who clicked an invite link before finishing login/Silpo-connect gets sent back here — see
  // /join/[code], which parks the code in this cookie rather than losing it across that redirect chain.
  const pendingJoinCode = (await cookies()).get(PENDING_JOIN_COOKIE)?.value;
  if (pendingJoinCode) redirect(`/join/${pendingJoinCode}`);

  const { error } = await searchParams;
  const parties = (await listMyParties(user.id)) as Array<Record<string, unknown>>;
  const firstName = ((user.user_metadata.full_name ?? user.user_metadata.name ?? "") as string).split(" ")[0];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col sm:max-w-[30rem] md:max-w-[34rem]">
      <header className="px-5 pb-2 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <p className="text-sm text-ink-soft">{firstName ? `Привіт, ${firstName}` : "Привіт"}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Ваші вечірки</h1>
      </header>

      <main className="flex-1 space-y-6 px-5 pb-10">
        {error && <InlineAlert tone="error">{errorMessage(error)}</InlineAlert>}

        <Panel className="space-y-4">
          <h2 className="font-medium">Створити вечірку</h2>
          <form action={createPartyAction} noValidate className="space-y-3">
            <input
              name="name"
              placeholder="Назва вечірки"
              required
              className="w-full rounded-[var(--radius-md)] border border-stone bg-paper px-3 py-2.5 text-[0.95rem] placeholder:text-stone-600"
            />
            <ModeCardPicker name="mode" defaultValue="EVENT" />
            <input
              name="budgetUah"
              type="number"
              min="0"
              step="0.01"
              placeholder="Бюджет, грн (необов'язково)"
              className="w-full rounded-[var(--radius-md)] border border-stone bg-paper px-3 py-2.5 text-[0.95rem] placeholder:text-stone-600"
            />
            <SubmitButton pendingText="Створюємо…" className="w-full">Створити вечірку</SubmitButton>
          </form>
        </Panel>

        <details className="group rounded-[var(--radius-md)] border border-stone px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm text-ink-soft [&::-webkit-details-marker]:hidden">
            <span>Отримали код запрошення, а не посилання?</span>
            <span className="text-xs transition-transform group-open:rotate-180">▾</span>
          </summary>
          <form action={joinPartyAction} noValidate className="mt-3 flex gap-2">
            <input
              name="joinCode"
              placeholder="Код або посилання-запрошення"
              required
              className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-stone bg-paper px-3 py-2.5 text-[0.95rem] placeholder:text-stone-600"
            />
            <SubmitButton variant="secondary" pendingText="…">Увійти</SubmitButton>
          </form>
        </details>

        <section className="space-y-3">
          <h2 className="font-medium">Мої вечірки</h2>
          {parties.length === 0 ? (
            <InlineAlert tone="empty">
              Тут з&apos;являться ваші вечірки. Створіть першу вище або відкрийте посилання-запрошення від друга.
            </InlineAlert>
          ) : (
            <ul className="space-y-2">
              {parties.map((party) => (
                <li key={party.id as string}>
                  <Link
                    href={`/parties/${party.id}`}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-stone bg-paper-raised px-4 py-3 transition-colors hover:border-ink-soft/50"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ModeDot mode={party.mode as PartyMode} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{party.name as string}</span>
                        <span className="block text-xs text-ink-soft">
                          {party.role === "CREATOR" ? "Ви організатор" : "Учасник"} ·{" "}
                          {party.status === "ACTIVE" ? "триває" : "завершено"}
                        </span>
                      </span>
                    </span>
                    {party.budget_uah != null && (
                      <Money amount={Number(party.budget_uah)} className="shrink-0 text-sm text-ink-soft" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
