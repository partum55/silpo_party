import type { ReactNode } from "react";

const TONE = {
  error: "border-danger/30 bg-danger-soft text-danger",
  info: "border-stone bg-stone-soft/60 text-ink-soft",
  empty: "border-dashed border-stone text-ink-soft",
} as const;

export function InlineAlert({
  tone = "info",
  children,
}: {
  tone?: keyof typeof TONE;
  children: ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={`rounded-[var(--radius-md)] border px-3 py-2.5 text-sm leading-snug ${TONE[tone]}`}
    >
      {children}
    </p>
  );
}
