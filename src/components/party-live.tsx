"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { buildCart } from "@/demo/cart";
import { DEMO_ONLY } from "@/demo/copy";
import { ME, type Scenario, type Seed } from "@/demo/scenarios";
import { MODE_COPY } from "@/lib/party/mode-copy";
import { AGENT_THINKING_COPY, type AgentStatus } from "@/lib/party/agent-status-copy";

import { ChatMessages } from "@/components/party/chat-panel";
import { MembersPanel } from "@/components/party/members-panel";
import { PlanPanel } from "@/components/party/plan-panel";
import type { ChatMessage, PartyStatus, Recipe } from "@/components/party/types";

import { Button, SubmitButton } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ModeBadge } from "@/components/ui/mode-badge";
import { TabBar } from "@/components/ui/tab-bar";
import { ChatIcon, CheckIcon, ListIcon } from "@/components/ui/icons";

// The demo has no backend: the "agent" replays the scenario's scripted steps. The input comes pre-filled with the
// next step's prompt; sending it as-is runs the step, anything else gets a canned reply and doesn't advance.
const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

export function PartyLive({ scenario }: { scenario: Scenario }) {
  const [party, setParty] = useState<PartyStatus>({
    status: "ACTIVE",
    agent_status: "IDLE",
    agent_error: null,
    active_agent_message_id: null,
    join_code: "DEMO",
    mode: scenario.mode,
    budget_uah: scenario.budget,
  });
  const [members, setMembers] = useState(scenario.members);
  const [messages, setMessages] = useState(scenario.messages);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [content, setContent] = useState(scenario.steps[0]?.prompt ?? "");
  const [tab, setTab] = useState<"chat" | "plan">("chat");
  const listRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nextId = useRef(0);

  const thinkingLabel = AGENT_THINKING_COPY[party.agent_status as AgentStatus];
  const busy = Boolean(thinkingLabel);
  const isActive = party.status === "ACTIVE";
  const step = scenario.steps[stepIndex];
  const cart = buildCart(scenario.mode, seeds, recipes, members, !isActive);
  const memberByUserId = new Map(members.map((member) => [member.user_id, member]));
  const selfReady = memberByUserId.get(ME)?.ready ?? false;

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    listRef.current?.scrollIntoView({ block: "end" });
  }, [messages, tab, thinkingLabel]);

  const later = (ms: number, fn: () => void) => void timers.current.push(setTimeout(fn, ms));
  const setAgent = (agent_status: AgentStatus, active_agent_message_id: string | null) =>
    setParty((previous) => ({ ...previous, agent_status, active_agent_message_id }));
  const newMessage = (sender_type: ChatMessage["sender_type"], text: string, from: string | null, replyTo: string | null = null): ChatMessage => ({
    id: `demo-${nextId.current++}`,
    sender_type,
    sender_user_id: from,
    content: text,
    reply_to_message_id: replyTo,
    created_at: new Date().toISOString(),
  });

  function ask(text: string) {
    const question = newMessage("USER", text, ME);
    setMessages((previous) => [...previous, question]);
    setAgent("THINKING", question.id);

    const matched = step && normalize(step.prompt) === normalize(text);
    const reply = (answer: string) => {
      setMessages((previous) => [...previous, newMessage("AGENT", answer, null, question.id)]);
      setAgent("IDLE", null);
      setContent((matched ? scenario.steps[stepIndex + 1] : step)?.prompt ?? "");
    };

    if (!matched) {
      later(900, () => reply(step
        ? "У демо я відповідаю на підготовлені запити — надішліть підказку з поля введення."
        : "Сценарій демо завершено. Перегляньте вкладку «План» або оберіть іншу вечірку на головній."));
      return;
    }
    later(800, () => setAgent("SEARCHING", question.id));
    later(1700, () => setAgent("UPDATING_CART", question.id));
    later(2400, () => {
      setSeeds((previous) => [...previous, ...step.items]);
      setRecipes((previous) => [...previous, ...(step.recipes ?? [])]);
      setMembers((previous) => previous.map((member) => member.user_id === ME
        ? { ...member, wishes: [...member.wishes, { id: `${ME}-w${member.wishes.length}`, text: step.prompt, fulfillmentStrategy: "either" }] }
        : member));
      setStepIndex((index) => index + 1);
      reply(step.reply);
    });
  }

  function send(event: React.FormEvent) {
    event.preventDefault();
    const text = content.trim();
    if (!text || busy) return;
    setContent("");
    ask(text);
  }

  const changeItem = (itemId: string, quantity: number | null) =>
    setSeeds((previous) => quantity === null
      ? previous.filter((seed) => seed.id !== itemId)
      : previous.map((seed) => seed.id === itemId ? { ...seed, qty: quantity } : seed));

  const toggleReady = (ready: boolean) =>
    setMembers((previous) => previous.map((member) => member.user_id === ME ? { ...member, ready } : member));

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[26rem] flex-col sm:max-w-[30rem] md:max-w-[34rem]">
      <header className="shrink-0 space-y-2.5 border-b border-stone px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-ink-soft" aria-label="До моїх вечірок">
            ←
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{scenario.name}</h1>
          <ModeBadge mode={party.mode} />
        </div>
        <MembersPanel members={members} currentUserId={ME} />
        {!isActive && <InlineAlert tone="info">Вечірку завершено — кошик оформлено.</InlineAlert>}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div hidden={tab !== "chat"}>
          <ChatMessages
            messages={messages}
            currentUserId={ME}
            memberNames={memberByUserId}
            listRef={listRef}
            thinkingLabel={thinkingLabel}
            activeMessageId={party.active_agent_message_id}
          />
        </div>
        <div hidden={tab !== "plan"}>
          <PlanPanel
            party={party}
            cart={cart}
            members={members}
            currentUserId={ME}
            onItemChange={changeItem}
            isCreator
            budgetForm={
              <form
                noValidate
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = new FormData(event.currentTarget).get("budgetUah") as string;
                  setParty((previous) => ({ ...previous, budget_uah: value === "" ? null : Number(value) }));
                }}
              >
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
                {isActive && cart.items.length > 0 && (
                  <form
                    noValidate
                    className="flex-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setParty((previous) => ({ ...previous, status: "COMPLETED" }));
                    }}
                  >
                    <SubmitButton pendingText="Оформлюємо…" className="w-full">Фіналізувати кошик</SubmitButton>
                  </form>
                )}
                <Button type="button" variant="destructive" disabled title={DEMO_ONLY}>Видалити вечірку</Button>
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
              <Button type="button" variant="secondary" size="sm" onClick={() => toggleReady(false)}>
                Ще щось написати
              </Button>
            </div>
          ) : (
            <>
              <label className="mb-1.5 flex w-fit items-center gap-1.5 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => toggleReady(true)}
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
                  disabled={busy}
                  className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-stone bg-paper px-3 py-2 text-[0.95rem] disabled:opacity-50"
                />
                <Button type="submit" disabled={busy} size="sm" className="px-4">
                  {busy ? "…" : "Надіслати"}
                </Button>
              </form>
            </>
          )}
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
