"use client";

import type { ReactNode } from "react";

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; icon: ReactNode; badge?: number }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <nav
      className="sticky bottom-0 z-10 flex border-t border-stone bg-paper-raised/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
      aria-label="Розділи вечірки"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? "page" : undefined}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
              isActive ? "text-tomato" : "text-ink-soft"
            }`}
          >
            <span className="relative">
              {tab.icon}
              {Boolean(tab.badge) && (
                <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-tomato text-[0.6rem] text-white">
                  {tab.badge}
                </span>
              )}
            </span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
