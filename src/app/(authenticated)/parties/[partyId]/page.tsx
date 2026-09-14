import { requireUser } from "@/lib/auth";
import { getCart } from "@/lib/cart/service";
import { listMessages } from "@/lib/chat/service";
import { getParty, listMembers } from "@/lib/party/service";
import { RuleViolation } from "@/lib/party/rules";

import { deletePartyAction, finalizeCartAction, leavePartyAction, sendMessageAction } from "../actions";

export default async function PartyPage({
  params,
  searchParams,
}: {
  params: Promise<{ partyId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { partyId } = await params;
  const { error } = await searchParams;

  try {
    const [party, members, messages, cart] = await Promise.all([
      getParty(partyId, user.id),
      listMembers(partyId, user.id),
      listMessages(partyId, user.id),
      getCart(partyId, user.id),
    ]);
    const isCreator = party.role === "CREATOR";
    const isActive = party.status === "ACTIVE";
    const items = (cart.items ?? []) as Array<{ id: string; name: string; quantity: number; price_uah: number | null }>;

    return (
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <a href="/" className="text-sm text-zinc-500 underline">
          ← Мої вечірки
        </a>
        {error && <p role="alert" className="text-red-600">{error}</p>}

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">{party.name as string}</h1>
          <p className="text-sm text-zinc-500">
            Статус: {party.status as string} · Агент: {party.agent_status as string}
            {party.agent_status === "ERROR" && party.agent_error ? ` — ${party.agent_error as string}` : ""}
          </p>
          {isCreator && (
            <p className="text-sm">
              Код приєднання: <span className="font-mono font-semibold">{party.join_code as string}</span>
            </p>
          )}
        </header>

        <section>
          <h2 className="mb-1 font-medium">Учасники ({members.length}/10)</h2>
          <ul className="text-sm text-zinc-600">
            {members.map((member) => (
              <li key={member.user_id as string}>
                {member.user_id === user.id ? "Ви" : (member.user_id as string)} — {member.role as string}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-medium">Чат</h2>
          <ul className="max-h-80 space-y-1 overflow-y-auto rounded border p-3 text-sm">
            {messages.length === 0 && <li className="text-zinc-500">Повідомлень ще немає.</li>}
            {messages.map((message) => (
              <li key={message.id as string}>
                <span className="font-semibold">
                  {message.sender_type === "USER"
                    ? message.sender_user_id === user.id
                      ? "Ви"
                      : "Учасник"
                    : (message.sender_type as string)}
                  :
                </span>{" "}
                {message.content as string}
              </li>
            ))}
          </ul>
          {isActive && (
            <form action={sendMessageAction} className="flex gap-2">
              <input type="hidden" name="partyId" value={partyId} />
              <input
                name="content"
                placeholder="Напишіть агенту... (напр. «додай молоко»)"
                required
                className="flex-1 rounded border px-3 py-2"
              />
              <button type="submit" className="rounded bg-black px-4 py-2 text-white">
                Надіслати
              </button>
            </form>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="font-medium">Кошик ({cart.status as string})</h2>
          <ul className="space-y-1 text-sm">
            {items.length === 0 && <li className="text-zinc-500">Кошик порожній.</li>}
            {items.map((item) => (
              <li key={item.id}>
                {item.name} × {item.quantity} — {item.price_uah ?? "?"} грн
              </li>
            ))}
          </ul>
          <p className="font-medium">Разом: {(cart.total_uah as number | null) ?? 0} грн</p>
          {typeof cart.checkout_url === "string" && cart.checkout_url && (
            <a href={cart.checkout_url} target="_blank" rel="noopener noreferrer" className="text-sm underline">
              Оформити на Silpo →
            </a>
          )}
        </section>

        <section className="flex flex-wrap gap-2">
          {isCreator && isActive && (
            <form action={finalizeCartAction}>
              <input type="hidden" name="partyId" value={partyId} />
              <button type="submit" className="rounded bg-green-700 px-4 py-2 text-white">
                Фіналізувати кошик
              </button>
            </form>
          )}
          {!isCreator && isActive && (
            <form action={leavePartyAction}>
              <input type="hidden" name="partyId" value={partyId} />
              <button type="submit" className="rounded border px-4 py-2">
                Покинути вечірку
              </button>
            </form>
          )}
          {isCreator && (
            <form action={deletePartyAction}>
              <input type="hidden" name="partyId" value={partyId} />
              <button type="submit" className="rounded border border-red-600 px-4 py-2 text-red-600">
                Видалити вечірку
              </button>
            </form>
          )}
        </section>
      </main>
    );
  } catch (caught) {
    if (caught instanceof RuleViolation) {
      return (
        <main className="grid min-h-screen place-items-center p-6 text-center">
          <div className="space-y-2">
            <p>Немає доступу до цієї вечірки ({caught.code}).</p>
            <a href="/" className="underline">
              ← Мої вечірки
            </a>
          </div>
        </main>
      );
    }
    throw caught;
  }
}
