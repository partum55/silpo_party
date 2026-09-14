"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { deletePartyAction, finalizeCartAction, leavePartyAction, updatePartyBudgetAction } from "@/app/(authenticated)/parties/actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MODE_COPY } from "@/lib/party/mode-copy";
import { AGENT_THINKING_COPY, type AgentStatus } from "@/lib/party/agent-status-copy";

import { ChatMessages } from "@/components/party/chat-panel";
import { MembersPanel } from "@/components/party/members-panel";
import { PlanPanel } from "@/components/party/plan-panel";
import type { Cart, ChatMessage, Member, PartyStatus } from "@/components/party/types";

import { Button, SubmitButton } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ModeBadge } from "@/components/ui/mode-badge";
import { TabBar } from "@/components/ui/tab-bar";
import { ChatIcon, CheckIcon, ListIcon } from "@/components/ui/icons";

// Everything on this page that can change without this viewer doing anything — a message from someone else,
// the agent's reply, its status ticking over, a member joining/leaving, the cart being rebuilt — arrives
// through one Supabase Realtime channel (RLS-scoped: only party members receive events) instead of requiring
// a page refresh. A status poll acts as a reconnect fallback because a browser/network can close that channel.
// party_members/carts/cart_items changes are refetched via the existing API routes rather
// than patched incrementally (simpler and safer given syncCartFromPlan replaces cart_items wholesale, which
// would otherwise show up as a burst of individual delete+insert events); chat_messages and the parties row
// itself are cheap to patch directly from the change payload.
export function PartyLive({
  partyId,
  partyName,
  currentUserId,
  isCreator,
  initialParty,
  initialMembers,
  initialMessages,
  initialCart,
}: {
  partyId: string;
  partyName: string;
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
  const [togglingReady, setTogglingReady] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "plan">("chat");
  const listRef = useRef<HTMLDivElement>(null);
  const lastAgentStatusRef = useRef(initialParty.agent_status);
  const thinkingLabel = AGENT_THINKING_COPY[party.agent_status as AgentStatus];

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;
    let realtimeConnected = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    async function readJson<T>(path: string): Promise<T | null> {
      try {
        const response = await fetch(path, { cache: "no-store" });
        return response.ok ? await response.json() as T : null;
      } catch {
        return null;
      }
    }

    const refreshMembers = async () => {
      const data = await readJson<Member[]>(`/api/parties/${partyId}/members`);
      if (active && data) setMembers(data);
    };
    const refreshMessages = async () => {
      const data = await readJson<ChatMessage[]>(`/api/parties/${partyId}/chat`);
      if (active && data) setMessages(data);
    };
    const refreshCart = async () => {
      const data = await readJson<Cart>(`/api/parties/${partyId}/cart`);
      if (active && data) setCart(data);
    };

    function applyAgentState(agentStatus: string, agentError: string | null) {
      const changed = agentStatus !== lastAgentStatusRef.current;
      lastAgentStatusRef.current = agentStatus;
      setParty((previous) => ({ ...previous, agent_status: agentStatus, agent_error: agentError }));
      if (changed && (agentStatus === "DONE" || agentStatus === "ERROR")) {
        void Promise.all([refreshMessages(), refreshCart()]);
      }
    }

    async function refreshAgentState() {
      const data = await readJson<{ agentStatus: string; agentError: string | null }>(
        `/api/parties/${partyId}/agent-status`,
      );
      if (active && data) applyAgentState(data.agentStatus, data.agentError);
    }

    async function poll() {
      await Promise.all([refreshAgentState(), ...(realtimeConnected ? [] : [refreshMessages()])]);
      if (active) pollTimer = setTimeout(poll, realtimeConnected ? 15_000 : 2_000);
    }

    const channel = supabase
      .channel(`party-${partyId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "parties", filter: `id=eq.${partyId}` },
        (payload) => {
          const next = payload.new as Record<string, unknown>;
          applyAgentState(next.agent_status as string, (next.agent_error as string | null) ?? null);
          setParty((previous) => ({
            ...previous,
            status: next.status as PartyStatus["status"],
            mode: (next.mode as PartyStatus["mode"] | undefined) ?? previous.mode,
            budget_uah: next.budget_uah === undefined
              ? previous.budget_uah
              : next.budget_uah === null ? null : Number(next.budget_uah),
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
        realtimeConnected = status === "SUBSCRIBED";
        // No UI depends on this — it's here so a silent Realtime connection failure (RLS denial, network
        // issue) shows up in the browser console instead of just looking like "nothing updates live".
        if (status !== "SUBSCRIBED") console.log(`[party-live] realtime channel status: ${status}`, err ?? "");
      });

    void poll();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void Promise.all([refreshAgentState(), refreshMessages(), refreshCart()]);
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      supabase.removeChannel(channel);
    };
  }, [partyId]);

  useEffect(() => {
    listRef.current?.scrollIntoView({ block: "end" });
  }, [messages, tab, thinkingLabel]);

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
      lastAgentStatusRef.current = "THINKING";
      setParty((previous) => ({ ...previous, agent_status: "THINKING", agent_error: null }));
    } catch {
      setContent(text); // put it back so nothing is silently lost
    } finally {
      setSending(false);
    }
  }

  async function toggleReady(ready: boolean) {
    if (togglingReady) return;
    setTogglingReady(true);
    setReadyError(null);
    try {
      const response = await fetch(`/api/parties/${partyId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ready }),
      });
      if (!response.ok) throw new Error();
      setMembers(await response.json() as Member[]);
    } catch {
      setReadyError("Не вдалося оновити статус. Спробуйте ще раз.");
    } finally {
      setTogglingReady(false);
    }
  }

  const isActive = party.status === "ACTIVE";
  const memberByUserId = new Map(members.map((member) => [member.user_id, member]));
  const selfReady = memberByUserId.get(currentUserId)?.ready ?? false;

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[26rem] flex-col sm:max-w-[30rem] md:max-w-[34rem]">
      <header className="shrink-0 space-y-2.5 border-b border-stone px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-ink-soft" aria-label="До моїх вечірок">
            ←
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{partyName}</h1>
          <ModeBadge mode={party.mode} />
        </div>
        <MembersPanel members={members} currentUserId={currentUserId} />
        {party.agent_status === "ERROR" && party.agent_error && (
          <InlineAlert tone="error">{party.agent_error}</InlineAlert>
        )}
        {!isActive && <InlineAlert tone="info">Вечірку завершено — кошик оформлено.</InlineAlert>}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div hidden={tab !== "chat"}>
          <ChatMessages messages={messages} currentUserId={currentUserId} memberNames={memberByUserId} listRef={listRef} thinkingLabel={thinkingLabel} />
        </div>
        <div hidden={tab !== "plan"}>
          <PlanPanel
            party={party}
            cart={cart}
            members={members}
            currentUserId={currentUserId}
            isCreator={isCreator}
            partyId={partyId}
            onCartUpdated={setCart}
            budgetForm={
              <form action={updatePartyBudgetAction} noValidate className="flex gap-2">
                <input type="hidden" name="partyId" value={partyId} />
                <input
                  name="budgetUah"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={party.budget_uah ?? ""}
                  placeholder="Бюджет, грн"
                  className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-stone bg-paper px-3 py-2 text-sm"
                />
                <SubmitButton variant="secondary" size="sm" pendingText="…">Зберегти</SubmitButton>
              </form>
            }
            actions={
              <>
                {isCreator && isActive && cart.items.length > 0 && (
                  <form action={finalizeCartAction} noValidate className="flex-1">
                    <input type="hidden" name="partyId" value={partyId} />
                    <SubmitButton pendingText="Оформлюємо…" className="w-full">Фіналізувати кошик</SubmitButton>
                  </form>
                )}
                {!isCreator && isActive && (
                  <form action={leavePartyAction} noValidate>
                    <input type="hidden" name="partyId" value={partyId} />
                    <SubmitButton variant="secondary" pendingText="…">Покинути вечірку</SubmitButton>
                  </form>
                )}
                {isCreator && (
                  <form action={deletePartyAction} noValidate>
                    <input type="hidden" name="partyId" value={partyId} />
                    <SubmitButton variant="destructive" pendingText="…">Видалити вечірку</SubmitButton>
                  </form>
                )}
              </>
            }
          />
        </div>
      </div>

      {tab === "chat" && isActive && (
        <div className="shrink-0 border-t border-stone bg-paper-raised px-3 py-2.5">
          {selfReady ? (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm text-ink-soft">
                <CheckIcon className="h-4 w-4 text-basil" />
                Ви позначили, що готові
              </span>
              <Button type="button" variant="secondary" size="sm" disabled={togglingReady} onClick={() => void toggleReady(false)}>
                {togglingReady ? "…" : "Ще щось написати"}
              </Button>
            </div>
          ) : (
            <>
              <label className="mb-1.5 flex w-fit items-center gap-1.5 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={false}
                  disabled={togglingReady}
                  onChange={() => void toggleReady(true)}
                  className="h-3.5 w-3.5 rounded border-stone accent-basil"
                />
                Я готовий(-а) — більше нічого не пишу
              </label>
              <form onSubmit={send} noValidate className="flex gap-2">
                <input
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder={MODE_COPY[party.mode].placeholder}
                  required
                  disabled={sending}
                  className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-stone bg-paper px-3 py-2 text-[0.95rem] disabled:opacity-50"
                />
                <Button type="submit" disabled={sending} size="sm" className="px-4">
                  {sending ? "…" : "Надіслати"}
                </Button>
              </form>
            </>
          )}
          {readyError && <p className="mt-1.5 text-xs text-danger" role="alert">{readyError}</p>}
        </div>
      )}

      <TabBar
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "chat", label: "Чат", icon: <ChatIcon className="h-5 w-5" /> },
          { id: "plan", label: "План", icon: <ListIcon className="h-5 w-5" />, badge: cart.items.length || undefined },
        ]}
      />
    </div>
  );
}
