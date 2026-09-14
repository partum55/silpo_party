"use client";

import { useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type ChatMessage = {
  id: string;
  sender_type: "USER" | "AGENT" | "SYSTEM";
  sender_user_id: string | null;
  content: string;
  created_at: string;
};

// Subscribes to Supabase Realtime for this party's chat_messages (RLS-scoped: only party members receive
// events) so new messages — including the agent's reply, inserted after it finishes processing — appear for
// every open tab without a page refresh or waiting on your own form submission to complete.
export function ChatPanel({
  partyId,
  currentUserId,
  initialMessages,
  active,
}: {
  partyId: string;
  currentUserId: string;
  initialMessages: ChatMessage[];
  active: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`party-chat-${partyId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `party_id=eq.${partyId}` },
        (payload) => {
          const next = payload.new as ChatMessage;
          setMessages((previous) => (previous.some((message) => message.id === next.id) ? previous : [...previous, next]));
        },
      )
      .subscribe();
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
    } catch {
      setContent(text); // put it back so nothing is silently lost
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2">
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
      {active && (
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
    </div>
  );
}
