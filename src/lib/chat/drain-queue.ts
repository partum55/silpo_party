/** Runs `work` strictly one after another, in call order; a failure does not block later work. */
function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>) => {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  };
}

export type SerialQueue = ReturnType<typeof createSerialQueue>;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Processes pending messages until none are left, running up to `limit` at once and starting messages that arrive
 * meanwhile (checked every `pollMs` while a slot is free). `process` gets a serial queue for the part of its work
 * that must not overlap, such as saving results. Returns the last failure, if any; a failed message does not stop
 * the others.
 */
export async function drainQueue<M extends { id: string }>({
  fetchPending,
  process,
  limit,
  pollMs,
  wait = delay,
}: {
  /** Up to `count` unprocessed messages, oldest first, excluding the ids already running. */
  fetchPending: (count: number, running: string[]) => Promise<M[]>;
  process: (message: M, serial: SerialQueue) => Promise<void>;
  limit: number;
  pollMs: number;
  wait?: (ms: number) => Promise<void>;
}): Promise<{ lastError: unknown }> {
  const running = new Map<string, Promise<void>>();
  const serial = createSerialQueue();
  let lastError: unknown = undefined;

  for (;;) {
    if (running.size < limit) {
      for (const message of await fetchPending(limit - running.size, [...running.keys()])) {
        const run = process(message, serial)
          .catch((error) => { lastError = error; })
          .finally(() => { running.delete(message.id); });
        running.set(message.id, run);
      }
    }
    if (!running.size) return { lastError };
    // Wake when a message finishes, or, while a slot is free, to start messages that arrived in the meantime.
    await Promise.race([...running.values(), ...(running.size < limit ? [wait(pollMs)] : [])]);
  }
}
