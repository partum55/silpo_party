import type { RefObject } from "react";

import { SparkleIcon } from "@/components/ui/icons";

import type { ChatMessage, Member } from "./types";

function bubbleClass(mine: boolean, senderType: ChatMessage["sender_type"]) {
  if (mine) return "bg-tomato text-white";
  if (senderType === "AGENT") return "bg-plum/10 text-ink border border-plum/20";
  return "bg-paper-raised border border-stone text-ink";
}

function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-[var(--radius-md)] border border-plum/20 bg-plum/10 px-3.5 py-2 text-sm text-ink">
        <p className="flex items-center gap-1.5">
          <SparkleIcon className="h-3.5 w-3.5 shrink-0 animate-pulse" />
          <span>{label}</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-plum [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-plum [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-plum" />
          </span>
        </p>
      </div>
    </div>
  );
}

export function ChatMessages({
  messages,
  currentUserId,
  memberNames,
  listRef,
  thinkingLabel,
}: {
  messages: ChatMessage[];
  currentUserId: string;
  memberNames: Map<string, Member>;
  listRef: RefObject<HTMLDivElement | null>;
  thinkingLabel: string | undefined;
}) {
  if (messages.length === 0 && !thinkingLabel) {
    return (
      <p className="px-5 py-8 text-center text-sm text-ink-soft">
        Напишіть перше повідомлення — розкажіть агенту, чого хочете.
      </p>
    );
  }

  return (
    <div ref={listRef} className="space-y-2.5 px-4 py-4">
      {messages.map((message) => {
        if (message.sender_type === "SYSTEM") {
          return (
            <p key={message.id} className="text-center text-xs text-stone-600">
              {message.content}
            </p>
          );
        }
        const mine = message.sender_type === "USER" && message.sender_user_id === currentUserId;
        const senderName = message.sender_type === "AGENT"
          ? "Агент"
          : mine
            ? "Ви"
            : (memberNames.get(message.sender_user_id ?? "")?.name ?? "Учасник");
        return (
          <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-[var(--radius-md)] px-3.5 py-2 text-sm leading-snug ${bubbleClass(mine, message.sender_type)}`}>
              {!mine && (
                <p className="mb-0.5 flex items-center gap-1 text-xs font-medium opacity-70">
                  {message.sender_type === "AGENT" && <SparkleIcon className="h-3 w-3" />}
                  {senderName}
                </p>
              )}
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          </div>
        );
      })}
      {thinkingLabel && <ThinkingBubble label={thinkingLabel} />}
    </div>
  );
}
