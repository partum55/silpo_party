export function ProgressBar({ ratio, danger = false }: { ratio: number; danger?: boolean }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-stone-soft" role="presentation">
      <div
        className={`h-full rounded-full transition-[width] ${danger ? "bg-danger" : "bg-basil"}`}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
