import { formatUahNumber } from "@/lib/format";

export function Money({ amount, className = "" }: { amount: number; className?: string }) {
  return (
    <span className={`font-numeral tabular-nums ${className}`}>
      {formatUahNumber(amount)}&nbsp;₴
    </span>
  );
}
