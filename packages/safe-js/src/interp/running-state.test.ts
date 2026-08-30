import { describe, expect, it } from "vitest";

import { dump } from "../dump.js";
import { run } from "../run.js";
import { restore } from "../restore.js";
import { Budget, SandboxError } from "./budget.js";
import { createGeneratorChannel } from "./generator.js";
import { declareHostOperation, wrapCallerInjectedBindings } from "./host-bridge.js";
import { getSandboxIterator } from "./iteration.js";
import { callArrayMethod } from "./methods/array.js";
import { callMapMethod, type MapMethodOptions } from "./methods/map.js";
import { resolveSandboxValue } from "./promise.js";
import { createSandboxClosure, createSandboxMap, type SandboxClosure } from "./values.js";

describe("interpreter running-state guards", () => {
  it("rejects recursive generator continuation and recovers after the callback throws", async () => {
    const holder: { channel?: ReturnType<typeof createGeneratorChannel> } = {};
    const channel = createGeneratorChannel(async (yieldValue) => {
      await expect(holder.channel?.next()).rejects.toEqual(
        expect.objectContaining({ code: "reentry", name: "SandboxError" })
      );
      await yieldValue(1);
      return 2;
    });
    holder.channel = channel;

    await expect(channel.next()).resolves.toEqual({ value: 1, done: false });
    await expect(channel.next()).resolves.toEqual({ value: 2, done: true });
  });

  it.each(["return", "throw"] as const)(
    "rejects generator %s while next is active",
    async (method) => {
      const holder: { channel?: ReturnType<typeof createGeneratorChannel> } = {};
      const channel = createGeneratorChannel(async (yieldValue) => {
        await expect(holder.channel?.[method](1)).rejects.toEqual(
          expect.objectContaining({ code: "reentry", name: "SandboxError" })
        );
        await yieldValue(1);
        return 2;
      });
      holder.channel = channel;

      await expect(channel.next()).resolves.toEqual({ value: 1, done: false });
      await expect(channel.next()).resolves.toEqual({ value: 2, done: true });
    }
  );

  it("rejects iterator return while next is active and runs finally once", async () => {
    let finallyCount = 0;
    const holder: { iterator?: ReturnType<typeof getSandboxIterator> } = {};
    const source = {
      [Symbol.iterator]() {
        return {
          next: async () => {
            expect(() => holder.iterator?.return?.()).toThrow(
              expect.objectContaining({ code: "reentry", name: "SandboxError" })
            );
            return { value: 1, done: false };
          },
          return: () => {
            finallyCount += 1;
            return { value: undefined, done: true };
          }
        };
      }
    } as never;
    const iterator = getSandboxIterator(source);
    holder.iterator = iterator;

    await expect(iterator?.next()).resolves.toEqual({ value: 1, done: false });
    expect(iterator?.return?.()).toEqual({ value: undefined, done: true });
    expect(finallyCount).toBe(1);
  });

  it("releases a synchronous iterator after next returns a promise object", async () => {
    let releaseNext: (() => void) | undefined;
    const source = {
      [Symbol.iterator]() {
        return {
          next: () =>
            new Promise<IteratorResult<number>>((resolve) => {
              releaseNext = () => resolve({ value: 1, done: false });
            }),
          return: () => ({ value: undefined, done: true })
        };
      }
    } as never;
    const iterator = getSandboxIterator(source)!;
    const pendingNext = iterator.next();

    expect(iterator.return?.()).toEqual({ value: undefined, done: true });
    releaseNext?.();
    await expect(pendingNext).resolves.toEqual({ value: 1, done: false });
    expect(iterator.return?.()).toEqual({ value: undefined, done: true });
  });

  it("rejects structural array mutation from a comparator and leaves the array usable", async () => {
    const budget = new Budget();
    const values = [3, 2, 1];
    const comparator = createSandboxClosure({
      name: "compare",
      call: async ([left, right]) => {
        await callArrayMethod(values, "push", [0], options);
        return Number(left) - Number(right);
      }
    });
    const options = {
      budget,
      callClosure: async (closure: SandboxClosure, args: readonly never[]) =>
        await closure.call(args)
    };

    await expect(callArrayMethod(values, "sort", [comparator], options)).rejects.toEqual(
      expect.objectContaining({ code: "reentry", name: "SandboxError" })
    );
    await expect(callArrayMethod(values, "push", [4], options)).resolves.toBe(4);
    expect(values).toEqual([3, 2, 1, 4]);
  });

  it("allows map mutation from forEach without using a stale collection cursor", async () => {
    const budget = new Budget();
    const target = createSandboxMap([["a", 1]]);
    const options: MapMethodOptions = {
      budget,
      callClosure: async (closure, args) => await closure.call(args)
    };
    const visited: unknown[] = [];
    const callback = createSandboxClosure({
      name: "mutate",
      call: async ([value, key]) => {
        visited.push([key, value]);
        return callMapMethod(target, "set", ["b", 2], options);
      }
    });

    await expect(callMapMethod(target, "forEach", [callback], options)).resolves.toBeUndefined();
    expect(visited).toEqual([
      ["a", 1],
      ["b", 2]
    ]);
    await expect(callMapMethod(target, "set", ["b", 2], options)).resolves.toBe(target);
    expect([...target.entries]).toEqual([
      ["a", 1],
      ["b", 2]
    ]);
  });

  it("rejects recursive invocation of the same sandbox callback passed to a host", async () => {
    let callback: ((value: number) => Promise<number>) | undefined;
    const wrapped = wrapCallerInjectedBindings(
      {
        invoke(received: (value: number) => Promise<number>) {
          callback = received;
          return received(1);
        }
      },
      { budget: new Budget() }
    );
    const sandboxCallback = createSandboxClosure({
      async: true,
      name: "callback",
      call: async ([value]) => {
        if (value === 1) {
          await callback?.(2);
        }
        return Number(value);
      }
    });

    const result = (wrapped.invoke as SandboxClosure).call([sandboxCallback]);
    await expect((result as { promise: Promise<unknown> }).promise).rejects.toEqual(
      expect.objectContaining({ code: "reentry", name: "SandboxError" })
    );
  });

  it("ignores duplicate promise settlement without affecting another promise", async () => {
    const duplicate = {
      then: createSandboxClosure({
        name: "then",
        call: ([resolve]) => {
          (resolve as SandboxClosure).call([1]);
          (resolve as SandboxClosure).call([2]);
          return undefined;
        }
      })
    };

    await expect(resolveSandboxValue(duplicate)).resolves.toBe(1);
    await expect(
      resolveSandboxValue({
        then: createSandboxClosure({
          call: ([resolve]) => (resolve as SandboxClosure).call([3])
        })
      })
    ).resolves.toBe(3);
  });

  it("allows an unrelated nested interpreter", async () => {
    const result = await run("return await nested()", {
      bindings: {
        async nested() {
          const nestedResult = await run("return 42");
          return nestedResult.ok ? nestedResult.returnValue : undefined;
        }
      }
    });

    expect(result).toMatchObject({ ok: true, returnValue: 42 });
  });

  it("rejects dumping the same run from inside its host callback", async () => {
    const holder: { activeRun?: ReturnType<typeof run> } = {};
    const activeRun = run("return await callback()", {
      bindings: {
        async callback() {
          await expect(Promise.resolve().then(() => dump(holder.activeRun!))).rejects.toEqual(
            expect.objectContaining({ code: "reentry", name: "SandboxError" })
          );
          return 1;
        }
      }
    });
    holder.activeRun = activeRun;

    await expect(activeRun).resolves.toMatchObject({ ok: true, returnValue: 1 });
  });

  it("rejects restoring the same snapshot while its run is active and clears ownership", async () => {
    const source = "return await callback()";
    const completed = await run(source, {
      bindings: { callback: async () => 1 }
    });
    const snapshot = completed.snapshot;
    let replayed = false;
    const activeRun = run(source, {
      snapshot,
      bindings: {
        callback: declareHostOperation(async () => 2, "re-issue", {
          onReplay() {
            replayed = true;
            expect(() => restore(snapshot, { source })).toThrowError(
              expect.objectContaining({ code: "reentry", name: "SandboxError" })
            );
          }
        })
      }
    });

    await expect(activeRun).resolves.toMatchObject({ ok: true, returnValue: 1 });
    expect(replayed).toBe(true);
    expect(restore(snapshot, { source })).toBe(snapshot);
  });

  it("uses a stable sandbox error shape", () => {
    expect(new SandboxError("reentry")).toMatchObject({
      code: "reentry",
      message: "Sandbox object is already running.",
      name: "SandboxError"
    });
  });
});
