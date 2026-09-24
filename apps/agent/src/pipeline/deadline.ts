/** Wall-clock budget for one agent turn, shared by every LLM and Silpo call inside it. */
export type Deadline = {
  remaining(): number;
  expired(): boolean;
  /** A signal that aborts at the deadline or after `maxMs`, whichever is sooner. */
  signal(maxMs: number): AbortSignal;
};

export function createDeadline(budgetMs: number, now: () => number = Date.now): Deadline {
  const end = now() + budgetMs;
  const remaining = () => Math.max(0, end - now());
  return {
    remaining,
    expired: () => remaining() <= 0,
    signal: (maxMs) => AbortSignal.timeout(Math.max(1, Math.min(maxMs, remaining()))),
  };
}

export const unlimitedDeadline: Deadline = {
  remaining: () => Number.POSITIVE_INFINITY,
  expired: () => false,
  signal: (maxMs) => AbortSignal.timeout(maxMs),
};
