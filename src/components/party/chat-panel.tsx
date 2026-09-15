import type { RefObject } from "react";

import { SparkleIcon } from "@/components/ui/icons";

import type { ChatMessage, Member } from "./types";

function bubbleClass(mine: boolean, senderType: ChatMessage["sender_type"]) {
  if (mine) return "bg-tomato text-ink";
  if (senderType === "AGENT") return "bg-plum/10 text-ink border border-plum/20";
  return "bg-paper-raised border border-stone text-ink";
}

function ReplyPreview({ message, senderName }: { message: ChatMessage; senderName: string }) {
  return (
    <div className="mb-1.5 border-l-2 border-plum/40 pl-2 text-xs opacity-70">
      <p className="font-medium">{senderName}</p>
      <p className="line-clamp-2">{message.content}</p>
    </div>
  );
}

function ThinkingBubble({ label, message, senderName }: { label: string; message?: ChatMessage; senderName?: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-[var(--radius-md)] border border-plum/20 bg-plum/10 px-3.5 py-2 text-sm text-ink">
        {message && senderName && <ReplyPreview message={message} senderName={senderName} />}
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
  activeMessageId,
}: {
  messages: ChatMessage[];
  currentUserId: string;
  memberNames: Map<string, Member>;
  listRef: RefObject<HTMLDivElement | null>;
  thinkingLabel: string | undefined;
  activeMessageId: string | null;
}) {
  if (messages.length === 0 && !thinkingLabel) {
    return (
      <p className="px-5 py-8 text-center text-sm text-ink-soft">
        Напишіть перше повідомлення — розкажіть агенту, чого хочете.
      </p>
    );
  }

  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const resolvedActiveMessage = activeMessageId ? messagesById.get(activeMessageId) : undefined;
  const newestUserMessage = messages.findLast((message) => message.sender_type === "USER");
  const activeMessage = resolvedActiveMessage
    // A status event may beat both the chat INSERT event and the status endpoint by one network round-trip.
    // This is display-only and is replaced by the authoritative activeMessageId as soon as it arrives.
    ?? (thinkingLabel ? newestUserMessage : undefined);
  const displayName = (message: ChatMessage) => message.sender_user_id === currentUserId
    ? "Ви"
    : (memberNames.get(message.sender_user_id ?? "")?.name ?? "Учасник");

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
          : displayName(message);
        const repliedTo = message.reply_to_message_id ? messagesById.get(message.reply_to_message_id) : undefined;
        return (
          <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-[var(--radius-md)] px-3.5 py-2 text-sm leading-snug ${bubbleClass(mine, message.sender_type)}`}>
              {!mine && (
                <p className="mb-0.5 flex items-center gap-1 text-xs font-medium opacity-70">
                  {message.sender_type === "AGENT" && <SparkleIcon className="h-3 w-3" />}
                  {senderName}
                </p>
              )}
              {message.sender_type === "AGENT" && repliedTo && (
                <ReplyPreview message={repliedTo} senderName={displayName(repliedTo)} />
              )}
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          </div>
        );
      })}
      {thinkingLabel && (
        <ThinkingBubble
          label={thinkingLabel}
          message={activeMessage}
          senderName={activeMessage ? displayName(activeMessage) : undefined}
        />
      )}
    </div>
  );
}
