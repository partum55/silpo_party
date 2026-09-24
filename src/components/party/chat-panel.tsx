import type { RefObject } from "react";

import { SparkleIcon } from "@/components/ui/icons";
import { parseRecipeMessages, type ParsedRecipeMessage } from "@/lib/chat/recipe-message";

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

function RecipeCard({ recipe }: { recipe: ParsedRecipeMessage }) {
  return (
    <div className="mt-2 overflow-hidden rounded-[var(--radius-lg)] border border-butter/50 bg-paper-raised shadow-sm">
      <div className="bg-gradient-to-br from-butter/35 via-tomato/10 to-plum/15 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-tomato-ink">Рецепт</p>
            <h3 className="mt-0.5 text-base font-semibold leading-tight text-ink">{recipe.title}</h3>
          </div>
          <span className="shrink-0 rounded-full border border-butter/60 bg-paper-raised/80 px-2.5 py-1 text-xs font-medium text-butter-ink">
            {recipe.servings}
          </span>
        </div>
      </div>

      <div className="space-y-4 px-4 py-3.5">
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-basil">Інгредієнти</h4>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {recipe.ingredients.map((ingredient, index) => (
              <li key={`${ingredient}-${index}`} className="rounded-lg bg-basil/8 px-2.5 py-2 text-xs leading-snug">
                <span className="mr-1.5 text-basil">●</span>{ingredient}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-plum">Приготування</h4>
          <ol className="space-y-2.5">
            {recipe.steps.map((step, index) => (
              <li key={`${step}-${index}`} className="flex gap-2.5 text-xs leading-relaxed">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-plum/15 font-semibold text-plum">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {recipe.source && (
          <a href={recipe.source} target="_blank" rel="noreferrer" className="inline-flex text-xs font-medium text-plum underline underline-offset-2">
            Переглянути джерело ↗
          </a>
        )}
      </div>
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
        const recipe = message.sender_type === "AGENT" ? parseRecipeMessages(message.content) : null;
        return (
          <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`${recipe ? "max-w-[96%]" : "max-w-[80%]"} rounded-[var(--radius-md)] px-3.5 py-2 text-sm leading-snug ${bubbleClass(mine, message.sender_type)}`}>
              {!mine && (
                <p className="mb-0.5 flex items-center gap-1 text-xs font-medium opacity-70">
                  {message.sender_type === "AGENT" && <SparkleIcon className="h-3 w-3" />}
                  {senderName}
                </p>
              )}
              {message.sender_type === "AGENT" && repliedTo && (
                <ReplyPreview message={repliedTo} senderName={displayName(repliedTo)} />
              )}
              {recipe ? (
                <>
                  {recipe.prefix && <p className="whitespace-pre-wrap">{recipe.prefix}</p>}
                  {recipe.recipes.map((item, index) => <RecipeCard key={`${item.title}-${index}`} recipe={item} />)}
                </>
              ) : (
                <p className="whitespace-pre-wrap">{message.content}</p>
              )}
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
