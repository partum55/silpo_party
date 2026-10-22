"use client";

import { useRef, useState, type ReactNode } from "react";

import { formatPurchaseUk } from "@/lib/format";
import { AvatarStack } from "@/components/ui/avatar";
import { Money } from "@/components/ui/money";
import { ProgressBar } from "@/components/ui/progress-bar";
import { TornPanel } from "@/components/ui/panel";
import { buttonClasses } from "@/components/ui/button-classes";
import { Button } from "@/components/ui/button";
import { BasketIcon, ChevronDownIcon, MinusIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";

import type { Cart, CartItem, Member, PartyStatus, Recipe } from "./types";

/** `quantity: null` removes the line. */
export type ItemChange = (itemId: string, quantity: number | null) => void;

function assignees(item: CartItem | Recipe, members: Member[], currentUserId: string) {
  const ids = "assigned_member_ids" in item ? item.assigned_member_ids : item.assignedMemberIds;
  if (!ids.length || ids.length >= members.length) return null; // shared by everyone — showing avatars adds no information
  const named = ids
    .map((id) => members.find((member) => member.user_id === id))
    .filter((member): member is Member => Boolean(member))
    .map((member) => ({ id: member.user_id, name: member.user_id === currentUserId ? "Ви" : member.name, avatarUrl: member.avatarUrl }));
  return named.length ? <AvatarStack members={named} max={3} /> : null;
}

function payerAvatars(item: CartItem, members: Member[], currentUserId: string) {
  return item.assigned_member_ids
    .map((id) => members.find((member) => member.user_id === id))
    .filter((member): member is Member => Boolean(member))
    .map((member) => ({
      id: member.user_id,
      name: member.user_id === currentUserId ? "Ви" : member.name,
      avatarUrl: member.avatarUrl,
    }));
}

function ItemRow({
  item,
  members,
  currentUserId,
  canEdit,
  onChange,
}: {
  item: CartItem;
  members: Member[];
  currentUserId: string;
  canEdit: boolean;
  onChange: ItemChange;
}) {
  const [value, setValue] = useState(String(item.quantity));
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const skipNextBlur = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prepareButtonClick = () => {
    if (document.activeElement === inputRef.current) skipNextBlur.current = true;
  };

  function mutate(quantity: number | null) {
    if (!canEdit) return;
    if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 1)) {
      setValue(String(item.quantity));
      setError("Кількість має бути цілим числом від 1.");
      return;
    }
    if (quantity === item.quantity) {
      setValue(String(item.quantity));
      return;
    }
    setError(null);
    onChange(item.id, quantity);
  }

  const payers = payerAvatars(item, members, currentUserId);

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-md)] bg-paper">
          {item.image_url && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- Silpo uses dynamic catalog image hosts.
            <img
              src={item.image_url}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-contain"
            />
          ) : (
            <BasketIcon className="h-6 w-6 text-stone-600" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-medium">{item.name}</p>
              <p className="truncate text-xs text-ink-soft">{formatPurchaseUk(item.package_size, item.quantity)}</p>
            </div>
            <Money amount={item.line_total_uah} className="shrink-0 text-sm" />
          </div>
          <div className="mt-2 flex min-h-8 flex-wrap items-center gap-2">
            <span className="text-xs text-ink-soft">Оплачують</span>
            {payers.length > 0 && <AvatarStack members={payers} max={5} />}
          </div>
        </div>
      </div>
      {canEdit && (
        <div className="mt-2 flex items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            disabled={Number(value) <= 1}
            onPointerDown={prepareButtonClick}
            onClick={() => mutate((Number(value) || item.quantity) - 1)}
            aria-label={`Зменшити кількість: ${item.name}`}
            title="Зменшити кількість"
          >
            <MinusIcon className="h-4 w-4" />
          </Button>
          <label className="sr-only" htmlFor={`quantity-${item.id}`}>Кількість: {item.name}</label>
          <input
            id={`quantity-${item.id}`}
            ref={inputRef}
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={value}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `quantity-error-${item.id}` : undefined}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "" || (/^\d+$/.test(next) && Number(next) >= 1)) setValue(next);
            }}
            onBlur={() => {
              if (skipNextBlur.current) {
                skipNextBlur.current = false;
                return;
              }
              mutate(Number(value));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="h-10 w-16 rounded-[var(--radius-md)] border border-stone bg-paper px-2 text-center font-numeral text-sm "
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onPointerDown={prepareButtonClick}
            onClick={() => mutate((Number(value) || item.quantity) + 1)}
            aria-label={`Збільшити кількість: ${item.name}`}
            title="Збільшити кількість"
          >
            <PlusIcon className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onPointerDown={prepareButtonClick}
            onClick={() => mutate(null)}
            className="ml-auto text-danger hover:bg-danger-soft hover:text-danger"
            aria-label={`Видалити товар: ${item.name}`}
            title="Видалити товар"
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        </div>
      )}
      {error && <p id={`quantity-error-${item.id}`} className="mt-1.5 text-xs text-danger" role="alert">{error}</p>}
    </li>
  );
}

function RecipeCard({ recipe, members, currentUserId }: { recipe: Recipe; members: Member[]; currentUserId: string }) {
  return (
    <details className="group rounded-[var(--radius-md)] border border-stone bg-paper-raised px-3 py-2.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{recipe.title}</span>
          <span className="flex items-center gap-2 text-xs text-ink-soft">
            {assignees(recipe, members, currentUserId)}
            <Money amount={recipe.cost_uah} />
          </span>
        </span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-ink-soft transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 space-y-3 border-t border-stone pt-3 text-sm">
        {recipe.sourceUrl && (
          <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-ink-soft underline underline-offset-2">
            Джерело рецепта
          </a>
        )}
        <div>
          <p className="mb-1 text-xs font-medium text-ink-soft">Інгредієнти</p>
          <ul className="space-y-0.5 text-ink-soft">
            {recipe.ingredients.map((ingredient, index) => (
              <li key={`${recipe.title}-ing-${index}`}>{ingredient.name}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-ink-soft">Кроки</p>
          <ol className="list-decimal space-y-1 pl-4 text-ink-soft">
            {recipe.steps.map((step, index) => <li key={`${recipe.title}-step-${index}`}>{step}</li>)}
          </ol>
        </div>
      </div>
    </details>
  );
}

export function PlanPanel({
  party,
  cart,
  members,
  currentUserId,
  budgetForm,
  actions,
  onItemChange,
}: {
  party: PartyStatus;
  cart: Cart;
  members: Member[];
  currentUserId: string;
  budgetForm: ReactNode;
  actions?: ReactNode;
  onItemChange: ItemChange;
}) {
  const total = cart.total_uah ?? 0;
  const budget = party.budget_uah;
  const overBudget = budget !== null && total > budget;

  return (
    <div className="space-y-4 px-4 py-4">
      {party.mode === "DINNER" && cart.recipes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-ink-soft">Обрані страви</h2>
          <div className="space-y-2">
            {cart.recipes.map((recipe) => (
              <RecipeCard key={recipe.title} recipe={recipe} members={members} currentUserId={currentUserId} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-1">
        <h2 className="text-sm font-medium text-ink-soft">
          {party.mode === "DINNER" ? "Список покупок" : "Кошик"}
        </h2>
        {cart.items.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-stone px-3 py-6 text-center text-sm text-ink-soft">
            Кошик поки порожній — напишіть у чат, чого хочете.
          </p>
        ) : (
          <ul className="divide-y divide-stone-soft rounded-[var(--radius-md)] border border-stone bg-paper-raised px-3">
            {cart.items.map((item) => (
              <ItemRow
                key={`${item.id}:${item.quantity}`}
                item={item}
                members={members}
                currentUserId={currentUserId}
                canEdit={party.status === "ACTIVE"}
                onChange={onItemChange}
              />
            ))}
          </ul>
        )}
      </section>

      <TornPanel className="space-y-3">
        {budget !== null && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-ink-soft">
              <span>Бюджет</span>
              <span className={overBudget ? "font-medium text-danger" : ""}>
                {overBudget ? "перевищено" : "залишок"}: <Money amount={Math.abs(budget - total)} />
              </span>
            </div>
            <ProgressBar ratio={total / budget} danger={overBudget} />
          </div>
        )}

        <div className="flex items-center justify-between border-t border-stone pt-3">
          <span className="text-sm font-medium">Разом</span>
          <Money amount={total} className="text-lg font-semibold" />
        </div>

        {cart.memberTotals.length > 1 && (
          <ul className="space-y-1 text-sm text-ink-soft">
            {cart.memberTotals.map((entry) => {
              const member = members.find((candidate) => candidate.user_id === entry.memberId);
              return (
                <li key={entry.memberId} className="flex items-center justify-between">
                  <span>{entry.memberId === currentUserId ? "Ви" : member?.name ?? "Учасник"}</span>
                  <Money amount={entry.amountUah} />
                </li>
              );
            })}
          </ul>
        )}

        {party.status === "ACTIVE" && (
          <details className="border-t border-stone pt-3 text-sm">
            <summary className="cursor-pointer text-ink-soft [&::-webkit-details-marker]:hidden">Змінити бюджет</summary>
            <div className="mt-2">{budgetForm}</div>
          </details>
        )}

        {cart.checkout_url && (
          <a
            href={cart.checkout_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClasses("primary", "md")} mt-1 w-full`}
          >
            Оформити на Silpo (демо)
          </a>
        )}
      </TornPanel>

      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}

    </div>
  );
}
