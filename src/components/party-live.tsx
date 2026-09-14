"use client";

import { useEffect, useRef, useState } from "react";

import { deletePartyAction, finalizeCartAction, leavePartyAction } from "@/app/(authenticated)/parties/actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type ChatMessage = {
  id: string;
  sender_type: "USER" | "AGENT" | "SYSTEM";
  sender_user_id: string | null;
  content: string;
  created_at: string;
};

type Member = { user_id: string; role: "CREATOR" | "MEMBER"; joined_at: string };

type CartItem = { id: string; name: string; quantity: number; price_uah: number | null };

type Cart = { status: "DRAFT" | "FINALIZED"; total_uah: number | null; checkout_url: string | null; items: CartItem[] };

type PartyStatus = {
  status: "ACTIVE" | "COMPLETED";
  agent_status: string;
  agent_error: string | null;
  join_code: string;
};

// Everything on this page that can change without this viewer doing anything — a message from someone else,
// the agent's reply, its status ticking over, a member joining/leaving, the cart being rebuilt — arrives
// through one Supabase Realtime channel (RLS-scoped: only party members receive events) instead of requiring
// a page refresh. party_members/carts/cart_items changes are refetched via the existing API routes rather
// than patched incrementally (simpler and safer given syncCartFromPlan replaces cart_items wholesale, which
// would otherwise show up as a burst of individual delete+insert events); chat_messages and the parties row
// itself are cheap to patch directly from the change payload.
export function PartyLive({
  partyId,
  currentUserId,
  isCreator,
  initialParty,
  initialMembers,
  initialMessages,
  initialCart,
}: {
  partyId: string;
  currentUserId: string;
  isCreator: boolean;
  initialParty: PartyStatus;
  initialMembers: Member[];
  initialMessages: ChatMessage[];
  initialCart: Cart;
}) {
  const [party, setParty] = useState(initialParty);
  const [members, setMembers] = useState(initialMembers);
  const [messages, setMessages] = useState(initialMessages);
  const [cart, setCart] = useState(initialCart);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const refreshMembers = () =>
      fetch(`/api/parties/${partyId}/members`).then((response) => (response.ok ? response.json() : null)).then((data) => data && setMembers(data));
    const refreshCart = () =>
      fetch(`/api/parties/${partyId}/cart`).then((response) => (response.ok ? response.json() : null)).then((data) => data && setCart(data));

    const channel = supabase
      .channel(`party-${partyId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "parties", filter: `id=eq.${partyId}` },
        (payload) => {
          const next = payload.new as Record<string, unknown>;
          setParty((previous) => ({
            ...previous,
            status: next.status as PartyStatus["status"],
            agent_status: next.agent_status as string,
            agent_error: (next.agent_error as string | null) ?? null,
          }));
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "party_members", filter: `party_id=eq.${partyId}` }, refreshMembers)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "carts", filter: `party_id=eq.${partyId}` }, refreshCart)
      .on("postgres_changes", { event: "*", schema: "public", table: "cart_items", filter: `party_id=eq.${partyId}` }, refreshCart)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `party_id=eq.${partyId}` },
        (payload) => {
          const next = payload.new as ChatMessage;
          setMessages((previous) => (previous.some((message) => message.id === next.id) ? previous : [...previous, next]));
        },
      )
      .subscribe((status, err) => {
        // No UI depends on this — it's here so a silent Realtime connection failure (RLS denial, network
        // issue) shows up in the browser console instead of just looking like "nothing updates live".
        if (status !== "SUBSCRIBED") console.log(`[party-live] realtime channel status: ${status}`, err ?? "");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [partyId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    setContent("");
    try {
      const response = await fetch(`/api/parties/${partyId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!response.ok) throw new Error(await response.text());
      // Show it immediately from the response rather than waiting on the Realtime echo — same id, so the
      // later postgres_changes INSERT for this same row (if it arrives at all, and whenever it does) is
      // correctly deduped by the handler above instead of appearing as a second copy.
      const sent = (await response.json()) as ChatMessage;
      setMessages((previous) => (previous.some((message) => message.id === sent.id) ? previous : [...previous, sent]));
    } catch {
      setContent(text); // put it back so nothing is silently lost
    } finally {
      setSending(false);
    }
  }

  const isActive = party.status === "ACTIVE";

  return (
    <>
      <p className="text-sm text-zinc-500">
        Статус: {party.status} · Агент: {party.agent_status}
        {party.agent_status === "ERROR" && party.agent_error ? ` — ${party.agent_error}` : ""}
      </p>
      {isCreator && (
        <p className="text-sm">
          Код приєднання: <span className="font-mono font-semibold">{party.join_code}</span>
        </p>
      )}

      <section>
        <h2 className="mb-1 font-medium">Учасники ({members.length}/10)</h2>
        <ul className="text-sm text-zinc-600">
          {members.map((member) => (
            <li key={member.user_id}>
              {member.user_id === currentUserId ? "Ви" : member.user_id} — {member.role}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Чат</h2>
        <ul ref={listRef} className="max-h-80 space-y-1 overflow-y-auto rounded border p-3 text-sm">
          {messages.length === 0 && <li className="text-zinc-500">Повідомлень ще немає.</li>}
          {messages.map((message) => (
            <li key={message.id}>
              <span className="font-semibold">
                {message.sender_type === "USER"
                  ? message.sender_user_id === currentUserId
                    ? "Ви"
                    : "Учасник"
                  : message.sender_type}
                :
              </span>{" "}
              {message.content}
            </li>
          ))}
        </ul>
        {isActive && (
          <form onSubmit={send} className="flex gap-2">
            <input
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Напишіть агенту... (напр. «додай молоко»)"
              required
              disabled={sending}
              className="flex-1 rounded border px-3 py-2 disabled:opacity-50"
            />
            <button type="submit" disabled={sending} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
              {sending ? "Надсилання…" : "Надіслати"}
            </button>
          </form>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Кошик ({cart.status})</h2>
        <ul className="space-y-1 text-sm">
          {cart.items.length === 0 && <li className="text-zinc-500">Кошик порожній.</li>}
          {cart.items.map((item) => (
            <li key={item.id}>
              {item.name} × {item.quantity} — {item.price_uah ?? "?"} грн
            </li>
          ))}
        </ul>
        <p className="font-medium">Разом: {cart.total_uah ?? 0} грн</p>
        {cart.checkout_url && (
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
    </>
  );
}
