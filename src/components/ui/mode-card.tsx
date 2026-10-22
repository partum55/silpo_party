"use client";

import { useId, useState } from "react";

import { MODE_COPY, MODE_ORDER, type PartyMode } from "@/lib/party/mode-copy";
import { MODE_VISUAL } from "./mode-visual";

export function ModeCardPicker({
  name,
  defaultValue = "EVENT",
}: {
  name: string;
  defaultValue?: PartyMode;
}) {
  const [selected, setSelected] = useState<PartyMode>(defaultValue);
  const groupId = useId();
  const activeCopy = MODE_COPY[selected];

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Формат вечірки</legend>
      <div className="grid grid-cols-3 gap-2">
        {MODE_ORDER.map((mode) => {
          const copy = MODE_COPY[mode];
          const visual = MODE_VISUAL[copy.accent];
          const Icon = visual.icon;
          const isSelected = mode === selected;
          return (
            <label
              key={mode}
              htmlFor={`${groupId}-${mode}`}
              className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[var(--radius-md)] border px-2 py-3 text-center transition-colors ${
                isSelected ? "border-ink/70 bg-paper-raised shadow-[0_1px_0_var(--stone)]" : "border-stone bg-paper-raised hover:border-ink-soft/50"
              }`}
            >
              <input
                id={`${groupId}-${mode}`}
                type="radio"
                name={name}
                value={mode}
                checked={isSelected}
                onChange={() => setSelected(mode)}
                className="sr-only"
                required
              />
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${isSelected ? visual.solid : visual.soft}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-medium leading-tight">{copy.label}</span>
            </label>
          );
        })}
      </div>
      <p className="text-xs leading-snug text-ink-soft">
        {activeCopy.description} <span className="text-stone-600">Спробуйте: «{activeCopy.example}».</span>
      </p>
    </fieldset>
  );
}
