import assert from "node:assert/strict";
import test from "node:test";

import { drainQueue } from "../src/lib/chat/drain-queue.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** An inbox the queue reads from; `arrive` adds messages while it is draining. */
function inbox(initial: string[]) {
  const pending = [...initial];
  const done = new Set<string>();
  return {
    arrive: (id: string) => pending.push(id),
    finish: (id: string) => done.add(id),
    done,
    fetchPending: async (count: number, running: string[]) =>
      pending.filter((id) => !done.has(id) && !running.includes(id)).slice(0, count).map((id) => ({ id })),
  };
}

test("runs up to the limit at once, picks up messages that arrive meanwhile, and saves one at a time", async () => {
  const box = inbox(["a", "b", "c"]);
  let active = 0;
  let maxActive = 0;
  let saving = 0;
  let maxSaving = 0;
  const { lastError } = await drainQueue({
    limit: 2,
    pollMs: 0,
    wait: tick,
    fetchPending: box.fetchPending,
    process: async ({ id }, serial) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (id === "a") box.arrive("d");
      for (let step = 0; step < 3; step += 1) await tick();
      active -= 1;
      await serial(async () => {
        saving += 1;
        maxSaving = Math.max(maxSaving, saving);
        await tick();
        saving -= 1;
      });
      box.finish(id);
    },
  });
  assert.equal(lastError, undefined);
  assert.deepEqual([...box.done].sort(), ["a", "b", "c", "d"]);
  assert.equal(maxActive, 2);
  assert.equal(maxSaving, 1);
});

test("with a limit of one, messages run strictly in order", async () => {
  const box = inbox(["a", "b", "c"]);
  const order: string[] = [];
  await drainQueue({
    limit: 1,
    pollMs: 0,
    wait: tick,
    fetchPending: box.fetchPending,
    process: async ({ id }) => {
      order.push(`start ${id}`);
      await tick();
      order.push(`end ${id}`);
      box.finish(id);
    },
  });
  assert.deepEqual(order, ["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("a failed message does not stop the others and is reported", async () => {
  const box = inbox(["a", "b"]);
  const { lastError } = await drainQueue({
    limit: 2,
    pollMs: 0,
    wait: tick,
    fetchPending: box.fetchPending,
    process: async ({ id }) => {
      box.finish(id);
      if (id === "a") throw new Error("model down");
    },
  });
  assert.deepEqual([...box.done].sort(), ["a", "b"]);
  assert.equal((lastError as Error).message, "model down");
});
