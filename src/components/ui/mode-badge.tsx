import { MODE_COPY, type PartyMode } from "@/lib/party/mode-copy";
import { MODE_VISUAL } from "./mode-visual";

export function ModeBadge({ mode, className = "" }: { mode: PartyMode; className?: string }) {
  const copy = MODE_COPY[mode];
  const visual = MODE_VISUAL[copy.accent];
  const Icon = visual.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${visual.soft} ${className}`}>
      <Icon className="h-3.5 w-3.5" />
      {copy.label}
    </span>
  );
}

export function ModeDot({ mode }: { mode: PartyMode }) {
  const visual = MODE_VISUAL[MODE_COPY[mode].accent];
  return <span className={`inline-block h-2 w-2 rounded-full ${visual.dot}`} aria-hidden />;
}
