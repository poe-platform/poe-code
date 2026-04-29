import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { createSandboxClosure, createSandboxPromise } = await import("./interp/values.js");
const { run } = await import("./run.js");

describe("run snapshot checkpointing", () => {
  beforeEach(() => {
    vol.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes the current snapshot at the next yield after the interval elapses", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    let waitCalls = 0;

    const result = run(
      ["return await (async () => { await wait(); await wait(); return Math.random(); })();"].join("\n"),
      {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise((waitCalls += 1) === 1 ? first.promise : second.promise),
            name: "wait"
          })
        },
        randomSeed: 123,
        snapshotPath: "/checkpoints/agent-script.json"
      }
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(vol.existsSync("/checkpoints/agent-script.json")).toBe(false);

    vi.advanceTimersByTime(30_000);
    first.resolve("alpha");
    await flushMicrotasks();

    second.resolve("omega");
    const finished = await result;

    expect(finished).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053,
      snapshot: {
        random: {
          seed: 123,
          state: 1_218_640_798
        }
      }
    });

    const checkpoint = JSON.parse(vol.readFileSync("/checkpoints/agent-script.json", "utf8") as string) as {
      random?: {
        seed: number;
        state: number;
      };
    };

    expect(checkpoint).toMatchObject({
      random: {
        seed: 123
      }
    });
    expect(checkpoint.random?.state).not.toBe(finished.ok ? finished.snapshot.random?.state : undefined);
  });

  it("does not write a checkpoint when the interval elapses but execution finishes before another yield", async () => {
    const first = createDeferred<string>();
    let waitCalls = 0;

    const result = run("return await wait();", {
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: () => {
            waitCalls += 1;
            return createSandboxPromise(first.promise);
          },
          name: "wait"
        })
      },
      snapshotPath: "/checkpoints/agent-script.json"
    });

    await flushMicrotasks();
    expect(waitCalls).toBe(1);
    expect(vol.existsSync("/checkpoints/agent-script.json")).toBe(false);

    vi.advanceTimersByTime(30_000);
    first.resolve("done");

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
    expect(vol.existsSync("/checkpoints/agent-script.json")).toBe(false);
  });
});

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve
  };
}

async function flushMicrotasks(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}
