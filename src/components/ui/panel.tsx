import type { HTMLAttributes } from "react";

export function Panel({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[var(--radius-lg)] border border-stone bg-paper-raised p-4 ${className}`}
      {...props}
    />
  );
}

/** The one bold shape in the app: a torn receipt edge, used only for the plan/cart summary. */
export function TornPanel({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`torn-edge rounded-t-[var(--radius-lg)] border border-stone bg-paper-raised p-4 ${className}`}
      {...props}
    />
  );
}
