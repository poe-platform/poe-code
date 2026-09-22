import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension, type RealmOptions } from "./core.js";

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(options: RealmOptions = {}) {
  const callbacks: unknown[] = [];
  const marks: unknown[] = [];
  const tail = deferred();
  const sourceEntered = deferred();
  const sourceWait = deferred();
  const realm = createRealm({
    callbackScheduling: "after-prefix",
    ...options,
    bindings: {
      save: (callback: unknown) => {
        callbacks.push(callback);
      },
      mark: (value: unknown) => {
        marks.push(value);
      },
      wait: () => tail.promise,
      sourceWait: () => {
        sourceEntered.resolve();
        return sourceWait.promise;
      },
      ...options.bindings
    }
  });
  return { realm, callbacks, marks, tail, sourceEntered, sourceWait };
}

describe("explicit callback-prefix source scheduling", () => {
  it("admits later source without waiting for a tail and lets that source resolve it", async () => {
    const { realm, callbacks, marks } = fixture();
    try {
      expect(
        await realm.evaluate(`
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        const token = { value: 7 };
        save(async () => { mark("prefix"); await pending; mark("tail"); return token.value; });
      `)
      ).toMatchObject({ ok: true });
      const invocation = realm.startCallback(callbacks[0]);
      const settled = vi.fn();
      void invocation.result.then(settled, settled);
      await invocation.synchronous;
      expect(await realm.evaluate("const alias = token; return alias === token;")).toMatchObject({
        ok: true,
        returnValue: true
      });
      expect(settled).not.toHaveBeenCalled();
      expect(marks).toEqual(["prefix"]);
      expect(
        await realm.evaluate("token.value = 9; release(); return alias === token;")
      ).toMatchObject({ ok: true, returnValue: true });
      expect(await invocation.result).toBe(9);
      expect(marks).toEqual(["prefix", "tail"]);
    } finally {
      await realm.close();
    }
  });

  it.each([undefined, "after-prefix"] as const)(
    "preserves admission for %s",
    async (callbackScheduling) => {
      const { realm, callbacks } = fixture({ callbackScheduling });
      try {
        await realm.evaluate("save(async () => { await wait(); });");
        const invocation = realm.startCallback(callbacks[0]);
        void invocation.result.catch(() => undefined);
        await invocation.synchronous;
        if (callbackScheduling === undefined)
          await expect(realm.evaluate("return 1;")).rejects.toMatchObject({ code: "reentry" });
        else expect(await realm.evaluate("return 1;")).toMatchObject({ ok: true, returnValue: 1 });
      } finally {
        await realm.close();
      }
    }
  );

  it("rejects unknown scheduling modes", () => {
    expect(() =>
      createRealm({ callbackScheduling: "anything" } as unknown as RealmOptions)
    ).toThrow(TypeError);
  });

  it.each([undefined, "after-prefix"] as const)(
    "lets a successful callback finish before an active source catches its rejection in %s mode",
    async (callbackScheduling) => {
      const cleanup = vi.fn();
      const { realm, callbacks, sourceEntered, sourceWait } = fixture({
        callbackScheduling,
        extensions: [
          defineExtension({
            manifest: { version: 1, name: "source-rejection-owner" },
            setup(context) {
              context.onCleanup(cleanup);
              return {};
            }
          })
        ]
      });
      try {
        await realm.evaluate("save(() => 1);");
        const source = realm.evaluate(`
        const caughtLater = Promise.reject("source-owned");
        await sourceWait();
        caughtLater.catch(() => undefined);
        return 7;
      `);
        void source.catch(() => undefined);
        await sourceEntered.promise;
        const callback = realm.startCallback(callbacks[0]);
        expect(await callback.result).toBe(1);
        await callback.synchronous;
        expect(cleanup).not.toHaveBeenCalled();
        sourceWait.resolve();
        expect(await source).toMatchObject({ ok: true, returnValue: 7 });
        expect(cleanup).not.toHaveBeenCalled();
        await realm.close();
        expect(cleanup).toHaveBeenCalledTimes(1);
      } finally {
        await realm.close();
      }
    }
  );

  it.each(["source", "callback"] as const)(
    "does not check another active callback's rejection when a %s completes",
    async (operation) => {
      const { realm, callbacks, tail } = fixture();
      try {
        await realm.evaluate(`
        save(async () => {
          const caughtLater = Promise.reject("callback-owned");
          await wait();
          caughtLater.catch(() => undefined);
          return 7;
        });
        save(() => 1);
      `);
        const pending = realm.startCallback(callbacks[0]);
        void pending.result.catch(() => undefined);
        await pending.synchronous;
        if (operation === "source")
          expect(await realm.evaluate("return 1;")).toMatchObject({ ok: true, returnValue: 1 });
        else {
          const other = realm.startCallback(callbacks[1]);
          expect(await other.result).toBe(1);
          await other.synchronous;
        }
        tail.resolve();
        expect(await pending.result).toBe(7);
      } finally {
        await realm.close();
      }
    }
  );

  it("attributes a resumed generator rejection to its callback without releasing the source gate", async () => {
    const cleaned = deferred();
    const cleanup = vi.fn(() => {
      cleaned.resolve();
    });
    const { realm, callbacks, sourceEntered } = fixture({
      extensions: [
        defineExtension({
          manifest: { version: 1, name: "generator-callback-owner" },
          setup(context) {
            context.onCleanup(cleanup);
            return {};
          }
        })
      ]
    });
    try {
      expect(
        await realm.evaluate(`
        const iterator = (function* () {
          yield 0;
          Promise.reject("resumed callback rejection");
          return 1;
        })();
        save(() => iterator.next().value);
      `)
      ).toMatchObject({ ok: true });
      const source = realm.evaluate("iterator.next(); await sourceWait(); return 7;");
      const sourceOutcome = Promise.allSettled([source]);
      await sourceEntered.promise;
      const callback = realm.startCallback(callbacks[0]);
      await expect(callback.result).rejects.toMatchObject({
        name: "UnhandledRejectionError",
        message: "Unhandled guest promise rejection: resumed callback rejection"
      });
      await callback.synchronous;
      expect(await sourceOutcome).toMatchObject([{ status: "rejected" }]);
      await cleaned.promise;
      expect(cleanup).toHaveBeenCalledTimes(1);
      await realm.close();
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      await realm.close();
    }
  });

  it("attributes a resumed generator rejection to its source without releasing the callback gate", async () => {
    const cleaned = deferred();
    const cleanup = vi.fn(() => {
      cleaned.resolve();
    });
    const { realm, callbacks } = fixture({
      extensions: [
        defineExtension({
          manifest: { version: 1, name: "generator-source-owner" },
          setup(context) {
            context.onCleanup(cleanup);
            return {};
          }
        })
      ]
    });
    try {
      expect(
        await realm.evaluate(`
        const iterator = (function* () {
          yield 0;
          Promise.reject("resumed source rejection");
          return 1;
        })();
        save(async () => { iterator.next(); await wait(); return 7; });
      `)
      ).toMatchObject({ ok: true });
      const callback = realm.startCallback(callbacks[0]);
      const callbackOutcome = Promise.allSettled([callback.result]);
      await callback.synchronous;
      await expect(realm.evaluate("return iterator.next().value;")).rejects.toMatchObject({
        name: "UnhandledRejectionError",
        message: "Unhandled guest promise rejection: resumed source rejection"
      });
      expect(await callbackOutcome).toMatchObject([{ status: "rejected" }]);
      await cleaned.promise;
      expect(cleanup).toHaveBeenCalledTimes(1);
      await realm.close();
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      await realm.close();
    }
  });

  it("keeps a generator's earlier promise reaction with its registering operation", async () => {
    const reacted = deferred();
    const { realm, callbacks, sourceEntered, sourceWait } = fixture({
      bindings: {
        reacted: () => {
          reacted.resolve();
        },
        reactionWait: () => reacted.promise
      }
    });
    try {
      expect(
        await realm.evaluate(`
        let caughtLater;
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        const iterator = (function* () {
          pending.then(() => {
            caughtLater = Promise.reject("registered reaction");
            reacted();
          });
          yield 0;
          release();
          return 1;
        })();
        save(async () => { iterator.next(); await reactionWait(); return 1; });
      `)
      ).toMatchObject({ ok: true });
      const source = realm.evaluate(`
        iterator.next();
        await sourceWait();
        caughtLater.catch(() => undefined);
        return 7;
      `);
      void source.catch(() => undefined);
      await sourceEntered.promise;
      const callback = realm.startCallback(callbacks[0]);
      void callback.result.catch(() => undefined);
      await reacted.promise;
      expect(await callback.result).toBe(1);
      await callback.synchronous;
      sourceWait.resolve();
      expect(await source).toMatchObject({ ok: true, returnValue: 7 });
    } finally {
      await realm.close();
    }
  });

  it("preserves source rejection ownership through queued promise jobs and guest awaits", async () => {
    const continued = deferred();
    const continuation = deferred();
    const { realm, callbacks, sourceEntered, sourceWait } = fixture({
      bindings: {
        continuationWait: () => {
          continued.resolve();
          return continuation.promise;
        }
      }
    });
    try {
      await realm.evaluate("save(() => 1);");
      const source = realm.evaluate(`
        await Promise.resolve().then(async () => {
          await sourceWait();
          const caughtLater = Promise.reject("continued-source-owned");
          await continuationWait();
          caughtLater.catch(() => undefined);
        });
        return 7;
      `);
      void source.catch(() => undefined);
      await sourceEntered.promise;
      sourceWait.resolve();
      await continued.promise;
      const callback = realm.startCallback(callbacks[0]);
      expect(await callback.result).toBe(1);
      await callback.synchronous;
      continuation.resolve();
      expect(await source).toMatchObject({ ok: true, returnValue: 7 });
    } finally {
      await realm.close();
    }
  });

  it.each(["source", "callback"] as const)(
    "detects a late rejection from a completed %s owner at a later callback checkpoint",
    async (operation) => {
      const cleaned = deferred();
      const { realm, callbacks } = fixture({
        extensions: [
          defineExtension({
            manifest: { version: 1, name: "late-rejection-owner" },
            setup(context) {
              context.onCleanup(() => {
                cleaned.resolve();
              });
              return {};
            }
          })
        ]
      });
      try {
        await realm.evaluate(`
        let rejectEarlier;
        save(() => { new Promise((resolve, reject) => { rejectEarlier = reject; }); return 1; });
        save(() => { rejectEarlier("late rejection"); return 2; });
      `);
        if (operation === "source") {
          expect(
            await realm.evaluate(
              "new Promise((resolve, reject) => { rejectEarlier = reject; }); return 1;"
            )
          ).toMatchObject({ ok: true, returnValue: 1 });
        } else {
          const earlier = realm.startCallback(callbacks[0]);
          expect(await earlier.result).toBe(1);
          await earlier.synchronous;
        }
        const later = realm.startCallback(callbacks[1]);
        await expect(later.result).rejects.toMatchObject({
          name: "UnhandledRejectionError",
          message: "Unhandled guest promise rejection: late rejection"
        });
        await cleaned.promise;
        await realm.close();
      } finally {
        await realm.close();
      }
    }
  );

  it.each(["successful", "rejecting"] as const)(
    "keeps a %s joined callback separate from its source's unfinished rejection",
    async (outcome) => {
      const { realm, callbacks } = fixture({
        grants: ["source:nested"],
        extensions: [
          defineExtension({
            manifest: {
              version: 1,
              name: "joined-rejection-owner",
              capabilities: ["source:nested"],
              globals: ["join"]
            },
            setup(context) {
              return {
                globals: {
                  join: context.nestedOperation(() => context.invokeCallback(callbacks[0]))
                }
              };
            }
          })
        ]
      });
      try {
        await realm.evaluate(
          outcome === "rejecting"
            ? 'save(() => { Promise.reject("callback-owned"); return 1; });'
            : "save(() => 1);"
        );
        const source = realm.evaluate(`
        const caughtLater = Promise.reject("source-owned");
        join();
        caughtLater.catch(() => undefined);
        return 7;
      `);
        if (outcome === "rejecting")
          await expect(source).rejects.toMatchObject({
            name: "UnhandledRejectionError",
            message: "Unhandled guest promise rejection: callback-owned"
          });
        else expect(await source).toMatchObject({ ok: true, returnValue: 7 });
        await realm.close();
      } finally {
        await realm.close();
      }
    }
  );

  it.each([undefined, "after-prefix"] as const)(
    "settles an unhandled guest callback rejection and automatically cleans up in %s mode",
    async (callbackScheduling) => {
      const cleaned = deferred();
      const cleanup = vi.fn(() => {
        cleaned.resolve();
      });
      const { realm, callbacks, marks } = fixture({
        callbackScheduling,
        extensions: [
          defineExtension({
            manifest: { version: 1, name: "unhandled-callback-cleanup" },
            setup(context) {
              context.onCleanup(cleanup);
              return {};
            }
          })
        ]
      });
      try {
        expect(
          await realm.evaluate(`
        save(() => { Promise.reject("callback rejection"); return 1; });
        save(() => { mark("still running"); return 2; });
      `)
        ).toMatchObject({ ok: true });
        const first = realm.startCallback(callbacks[0]);
        await expect(first.result).rejects.toMatchObject({
          name: "UnhandledRejectionError",
          message: "Unhandled guest promise rejection: callback rejection"
        });
        await expect(first.synchronous).resolves.toBeUndefined();
        const second = realm.startCallback(callbacks[1]);
        const outcomes = await Promise.allSettled([second.synchronous, second.result]);
        expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
        expect(marks).toEqual([]);
        await cleaned.promise;
        expect(cleanup).toHaveBeenCalledTimes(1);
        await Promise.all([realm.close(), realm.close()]);
        expect(cleanup).toHaveBeenCalledTimes(1);
      } finally {
        await realm.close();
      }
    }
  );

  it.each([undefined, "after-prefix"] as const)(
    "does not treat an observed guest callback rejection as unhandled in %s mode",
    async (callbackScheduling) => {
      const cleanup = vi.fn();
      const { realm, callbacks, marks } = fixture({
        callbackScheduling,
        extensions: [
          defineExtension({
            manifest: { version: 1, name: "handled-callback-cleanup" },
            setup(context) {
              context.onCleanup(cleanup);
              return {};
            }
          })
        ]
      });
      try {
        expect(
          await realm.evaluate(`
        save(() => Promise.reject("handled").catch(() => { mark("handled"); return 1; }));
        save(() => { mark("still running"); return 2; });
      `)
        ).toMatchObject({ ok: true });
        const first = realm.startCallback(callbacks[0]);
        expect(await first.result).toBe(1);
        await first.synchronous;
        const second = realm.startCallback(callbacks[1]);
        expect(await second.result).toBe(2);
        await second.synchronous;
        expect(marks).toEqual(["handled", "still running"]);
        expect(cleanup).not.toHaveBeenCalled();
        await realm.close();
        expect(cleanup).toHaveBeenCalledTimes(1);
      } finally {
        await realm.close();
      }
    }
  );

  it("detects an unhandled callback rejection without joining an unrelated pending tail", async () => {
    const cleaned = deferred();
    const cleanup = vi.fn(() => {
      cleaned.resolve();
    });
    const { realm, callbacks } = fixture({
      extensions: [
        defineExtension({
          manifest: { version: 1, name: "pending-tail-cleanup" },
          setup(context) {
            context.onCleanup(cleanup);
            return {};
          }
        })
      ]
    });
    try {
      await realm.evaluate(`
        save(async () => { await wait(); });
        save(() => { Promise.reject("callback rejection"); return 1; });
      `);
      const pending = realm.startCallback(callbacks[0]);
      const canceled = expect(pending.result).rejects.toMatchObject({
        name: "UnhandledRejectionError"
      });
      await pending.synchronous;
      const failing = realm.startCallback(callbacks[1]);
      await expect(failing.result).rejects.toMatchObject({ name: "UnhandledRejectionError" });
      await expect(failing.synchronous).resolves.toBeUndefined();
      await canceled;
      await cleaned.promise;
      expect(cleanup).toHaveBeenCalledTimes(1);
      await realm.close();
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      await realm.close();
    }
  });

  it("checks a joined callback's discarded rejection without waiting on its source owner", async () => {
    let joined!: Promise<unknown>;
    const { realm, callbacks } = fixture({
      grants: ["source:nested"],
      extensions: [
        defineExtension({
          manifest: {
            version: 1,
            name: "join-unhandled",
            capabilities: ["source:nested"],
            globals: ["join"]
          },
          setup(context) {
            return {
              globals: {
                join: context.nestedOperation(() => {
                  joined = context.invokeCallback(callbacks[0]);
                  return joined;
                })
              }
            };
          }
        })
      ]
    });
    try {
      await realm.evaluate('save(() => { Promise.reject("joined rejection"); return 1; });');
      await expect(realm.evaluate("join();")).rejects.toMatchObject({
        name: "UnhandledRejectionError"
      });
      await expect(joined).rejects.toMatchObject({ name: "UnhandledRejectionError" });
      await realm.close();
    } finally {
      await realm.close();
    }
  });

  it.each(["startCallback", "invokeCallback"] as const)(
    "tracks the actual prefix through %s",
    async (method) => {
      const { realm, callbacks } = fixture();
      try {
        await realm.evaluate("save(async () => { await wait(); });");
        const invocation =
          method === "startCallback"
            ? realm.startCallback(callbacks[0]).result
            : realm.invokeCallback(callbacks[0]);
        void invocation.catch(() => undefined);
        await expect(realm.evaluate("return 1;")).rejects.toMatchObject({ code: "reentry" });
      } finally {
        await realm.close();
      }
    }
  );

  it("does not equate a yielding nested host operation with a finished prefix", async () => {
    const entered = deferred();
    const release = deferred();
    const { realm, callbacks, marks } = fixture({
      grants: ["source:nested"],
      extensions: [
        defineExtension({
          manifest: {
            version: 1,
            name: "blocked-prefix",
            capabilities: ["source:nested"],
            globals: ["work"]
          },
          setup(context) {
            return {
              globals: {
                work: context.nestedOperation(async () => {
                  entered.resolve();
                  await release.promise;
                  await context.evaluateNested('mark("nested");');
                })
              }
            };
          }
        })
      ]
    });
    try {
      await realm.evaluate('save(async () => { work(); mark("prefix"); await wait(); });');
      const invocation = realm.startCallback(callbacks[0]);
      void invocation.result.catch(() => undefined);
      const completed = vi.fn();
      void invocation.synchronous.then(completed, completed);
      await entered.promise;
      await expect(realm.evaluate("return 1;")).rejects.toMatchObject({ code: "reentry" });
      expect(completed).not.toHaveBeenCalled();
      release.resolve();
      await invocation.synchronous;
      expect(marks).toEqual(["nested", "prefix"]);
      expect(await realm.evaluate("return 1;")).toMatchObject({ ok: true, returnValue: 1 });
    } finally {
      release.resolve();
      await realm.close();
    }
  });

  it("retains the newer source owner when an older callback finishes", async () => {
    const { realm, callbacks, tail, sourceEntered, sourceWait } = fixture();
    try {
      await realm.evaluate("save(async () => { await wait(); return 4; });");
      const invocation = realm.startCallback(callbacks[0]);
      await invocation.synchronous;
      const source = realm.evaluate("await sourceWait(); return 5;");
      void source.catch(() => undefined);
      await sourceEntered.promise;
      tail.resolve();
      expect(await invocation.result).toBe(4);
      await expect(realm.evaluate("return 6;")).rejects.toMatchObject({ code: "reentry" });
      sourceWait.resolve();
      expect(await source).toMatchObject({ ok: true, returnValue: 5 });
      expect(await realm.evaluate("return 6;")).toMatchObject({ ok: true, returnValue: 6 });
    } finally {
      await realm.close();
    }
  });

  it("rejects simultaneous sources even before either source starts", async () => {
    const { realm } = fixture();
    try {
      const first = realm.evaluate("return 1;");
      await expect(realm.evaluate("return 2;")).rejects.toMatchObject({ code: "reentry" });
      expect(await first).toMatchObject({ ok: true, returnValue: 1 });
    } finally {
      await realm.close();
    }
  });

  it("preserves queued callback prefix order and rejects source before all prefixes finish", async () => {
    const { realm, callbacks, marks, tail } = fixture();
    try {
      await realm.evaluate(
        'save(async () => { mark("first"); await wait(); mark("tail"); }); save(() => mark("second"));'
      );
      const first = realm.startCallback(callbacks[0]);
      const second = realm.startCallback(callbacks[1]);
      await expect(realm.evaluate("return 1;")).rejects.toMatchObject({ code: "reentry" });
      await Promise.all([first.synchronous, second.synchronous, second.result]);
      expect(await realm.evaluate('mark("source");')).toMatchObject({ ok: true });
      expect(marks).toEqual(["first", "second", "source"]);
      tail.resolve();
      await first.result;
      expect(marks).toEqual(["first", "second", "source", "tail"]);
    } finally {
      await realm.close();
    }
  });

  it("denies external evaluate called directly from a guest-owned host operation", async () => {
    let attempted!: Promise<unknown>;
    const { realm } = fixture({
      bindings: {
        reenter: () => {
          attempted = realm.evaluate("return 2;");
          void attempted.catch(() => undefined);
        }
      }
    });
    try {
      expect(await realm.evaluate("reenter(); return 1;")).toMatchObject({
        ok: true,
        returnValue: 1
      });
      await expect(attempted).rejects.toMatchObject({ code: "reentry" });
    } finally {
      await realm.close();
    }
  });

  it("keeps retained argument identity and compiled callback locals across later source", async () => {
    let reference: unknown;
    const budget = new Budget({ maxSteps: 100000 });
    const { realm, callbacks, tail } = fixture({
      budget,
      grants: ["guest:retain"],
      extensions: [
        defineExtension({
          manifest: {
            version: 1,
            name: "identity",
            capabilities: ["guest:retain"],
            globals: ["capture"]
          },
          setup(context) {
            return {
              globals: {
                capture: context.retainGuestArguments((value: unknown) => {
                  reference = value;
                }, 0)
              }
            };
          }
        })
      ]
    });
    try {
      await realm.evaluate(`
        const token = { value: "abc" }; capture(token);
        save(async value => { const local = /abc/; await wait(); return value === token && local.test(value.value); });
      `);
      const invocation = realm.startCallback(callbacks[0], { args: [reference] });
      await invocation.synchronous;
      realm.releaseCallback(callbacks[0]);
      realm.releaseGuestReference(reference);
      const before = budget.currentDataSize;
      expect(await realm.evaluate("return token.value;")).toMatchObject({
        ok: true,
        returnValue: "abc"
      });
      expect(budget.currentDataSize).toBeGreaterThanOrEqual(before);
      tail.resolve();
      expect(await invocation.result).toBe(true);
      await realm.close();
      expect(budget.currentDataSize).toBe(0);
      expect(budget.currentCallDepth).toBe(0);
    } finally {
      await realm.close();
    }
  });

  it.each(["source-error", "callback-error", "budget", "abort", "close"] as const)(
    "settles tails and a live source on %s before releasing the budget",
    async (action) => {
      const budget = new Budget({ maxSteps: action === "budget" ? 500 : 2000 });
      const controller = new AbortController();
      const cleanup = vi.fn(() => {
        expect(budget.currentCallDepth).toBe(0);
      });
      const { realm, callbacks, tail, sourceEntered } = fixture({
        budget,
        signal: controller.signal,
        extensions: [
          defineExtension({
            manifest: { version: 1, name: "cleanup" },
            setup(context) {
              context.onCleanup(cleanup);
              return {};
            }
          })
        ]
      });
      try {
        await realm.evaluate('save(async () => { await wait(); throw "tail failed"; });');
        const invocation = realm.startCallback(callbacks[0]);
        const result = expect(invocation.result).rejects.toBeDefined();
        await invocation.synchronous;
        if (action === "source-error" || action === "budget") {
          const sourceResult = expect(
            realm.evaluate(action === "budget" ? "while (true) {}" : 'throw "source failed";')
          );
          if (action === "budget") {
            await sourceResult.rejects.toMatchObject({ code: "budgetExceeded" });
          } else {
            await sourceResult.rejects.toBeDefined();
          }
        } else {
          const source = realm.evaluate("await sourceWait(); return 1;");
          const sourceResult = expect(source).rejects.toBeDefined();
          await sourceEntered.promise;
          if (action === "callback-error") tail.resolve();
          if (action === "abort") controller.abort(new Error("stopped"));
          if (action === "close") await realm.close();
          await sourceResult;
        }
        await result;
        await expect(invocation.synchronous).resolves.toBeUndefined();
        await Promise.all([realm.close(), realm.close()]);
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(budget.currentCallDepth).toBe(0);
        expect(budget.currentDataSize).toBe(0);
        expect([...budget.retainedValues()]).toEqual([]);
        const replacement = createRealm({ budget });
        await replacement.close();
      } finally {
        await realm.close();
      }
    }
  );

  it("charges later source and callbacks to the same cumulative step budget", async () => {
    const budget = new Budget({ maxSteps: 2000 });
    const { realm, callbacks } = fixture({ budget });
    try {
      await realm.evaluate("save(async () => { await wait(); });");
      const invocation = realm.startCallback(callbacks[0]);
      void invocation.result.catch(() => undefined);
      await invocation.synchronous;
      const before = budget.stepsUsed;
      expect(await realm.evaluate("return 1;")).toMatchObject({ ok: true });
      expect(budget.stepsUsed).toBeGreaterThan(before);
      await expect(realm.evaluate("while (true) {}")).rejects.toMatchObject({
        code: "budgetExceeded"
      });
      await expect(invocation.result).rejects.toBeDefined();
    } finally {
      await realm.close();
    }
  });

  it("preserves module namespaces, canonical identity and top-level await ownership", async () => {
    const { realm, callbacks, sourceEntered, sourceWait } = fixture({
      sourceResolver: () => ({ id: "shared", source: "export const token = {};" })
    });
    try {
      await realm.evaluate("save(async () => { await wait(); });");
      const invocation = realm.startCallback(callbacks[0]);
      void invocation.result.catch(() => undefined);
      await invocation.synchronous;
      const source = realm.evaluate(
        "import { token } from 'dep'; await sourceWait(); export const same = token;",
        { filename: "first", sourceType: "module" }
      );
      void source.catch(() => undefined);
      await sourceEntered.promise;
      await expect(realm.evaluate("return 1;")).rejects.toMatchObject({ code: "reentry" });
      sourceWait.resolve();
      expect(await source).toMatchObject({ ok: true, returnValue: { same: {} } });
      expect(
        await realm.evaluate(
          "import { token } from 'alias'; import { token as again } from 'dep'; export const same = token === again;",
          { filename: "second", sourceType: "module" }
        )
      ).toMatchObject({ ok: true, returnValue: { same: true } });
    } finally {
      await realm.close();
    }
  });

  it("does not join a callback's pending dynamic import into a later module", async () => {
    const requested = deferred();
    const module = deferred<{ id: string; source: string }>();
    const { realm, callbacks } = fixture({
      sourceResolver: () => {
        requested.resolve();
        return module.promise;
      }
    });
    try {
      await realm.evaluate(
        "save(async () => { const value = await import('pending'); return value.answer; });",
        { filename: "setup", sourceType: "module" }
      );
      const invocation = realm.startCallback(callbacks[0]);
      await Promise.all([invocation.synchronous, requested.promise]);
      expect(
        await realm.evaluate("export const answer = 42;", {
          filename: "later",
          sourceType: "module"
        })
      ).toMatchObject({ ok: true, returnValue: { answer: 42 } });
      module.resolve({ id: "pending", source: "export const answer = 7;" });
      expect(await invocation.result).toBe(7);
    } finally {
      await realm.close();
    }
  });

  it("rejects reentrant close instead of releasing live frames or self-waiting", async () => {
    let closing!: Promise<void>;
    const { realm } = fixture({
      bindings: {
        closeOwner: () => {
          closing = realm.close();
          void closing.catch(() => undefined);
          return closing;
        }
      }
    });
    try {
      await expect(realm.evaluate("await closeOwner();")).rejects.toBeDefined();
      await expect(closing).rejects.toMatchObject({ code: "reentry" });
      await realm.close();
    } finally {
      await realm.close();
    }
  });

  it.each(["abort", "close"] as const)(
    "rejects unfinished and queued prefixes on %s without waiting for a host release",
    async (action) => {
      const entered = deferred();
      const controller = new AbortController();
      const { realm, callbacks, marks } = fixture({
        signal: controller.signal,
        grants: ["source:nested"],
        extensions: [
          defineExtension({
            manifest: {
              version: 1,
              name: "hold",
              capabilities: ["source:nested"],
              globals: ["hold"]
            },
            setup(context) {
              return {
                globals: {
                  hold: context.nestedOperation(() => {
                    entered.resolve();
                    return new Promise(() => {});
                  })
                }
              };
            }
          })
        ]
      });
      try {
        await realm.evaluate(
          'save(async () => { hold(); mark("forbidden"); }); save(() => mark("queued"));'
        );
        const first = realm.startCallback(callbacks[0]);
        void first.result.catch(() => undefined);
        await entered.promise;
        const second = realm.startCallback(callbacks[1]);
        void second.result.catch(() => undefined);
        const outcomes = Promise.allSettled([
          first.synchronous,
          first.result,
          second.synchronous,
          second.result
        ]);
        if (action === "abort") controller.abort(new Error("stopped"));
        await realm.close();
        expect((await outcomes).every((outcome) => outcome.status === "rejected")).toBe(true);
        expect(marks).toEqual([]);
      } finally {
        await realm.close();
      }
    }
  );

  it("does not self-wait when a host operation joins a failing callback", async () => {
    const { realm, callbacks } = fixture({
      grants: ["source:nested"],
      extensions: [
        defineExtension({
          manifest: {
            version: 1,
            name: "join",
            capabilities: ["source:nested"],
            globals: ["join"]
          },
          setup(context) {
            return {
              globals: { join: context.nestedOperation(() => context.invokeCallback(callbacks[0])) }
            };
          }
        })
      ]
    });
    try {
      await realm.evaluate('save(() => { throw "callback failed"; });');
      await expect(realm.evaluate("join();")).rejects.toBeDefined();
      await realm.close();
    } finally {
      await realm.close();
    }
  });

  it("enforces the shared data budget while a tail retains its locals", async () => {
    const budget = new Budget({ dataSize: 100000 });
    const { realm, callbacks } = fixture({ budget });
    try {
      await realm.evaluate(
        "save(async () => { const local = [1, 2, 3]; await wait(); return local; });"
      );
      const invocation = realm.startCallback(callbacks[0]);
      const result = expect(invocation.result).rejects.toBeDefined();
      await invocation.synchronous;
      await expect(realm.evaluate('return "x".repeat(200000);')).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "dataSize"
      });
      await result;
      await realm.close();
      expect(budget.currentDataSize).toBe(0);
    } finally {
      await realm.close();
    }
  });

  it("keeps imports initiated by the current source within that source's completion", async () => {
    const requested = deferred();
    const loaded = deferred<{ id: string; source: string }>();
    const { realm } = fixture({
      sourceResolver: () => {
        requested.resolve();
        return loaded.promise;
      }
    });
    try {
      const source = realm.evaluate("void import('dep'); export const answer = 42;", {
        filename: "entry",
        sourceType: "module"
      });
      const settled = vi.fn();
      void source.then(settled, settled);
      await requested.promise;
      await expect(realm.evaluate("return 1;")).rejects.toMatchObject({ code: "reentry" });
      expect(settled).not.toHaveBeenCalled();
      loaded.resolve({ id: "dep", source: "export const value = 7;" });
      expect(await source).toMatchObject({ ok: true, returnValue: { answer: 42 } });
    } finally {
      await realm.close();
    }
  });

  it("rejects new work immediately during reentrant cancellation rather than joining disposal", async () => {
    let closedWork!: Promise<PromiseSettledResult<unknown>[]>;
    const { realm, callbacks } = fixture({
      bindings: {
        stop: () => {
          closedWork = Promise.allSettled([
            realm.close(),
            realm.evaluate("return 1;"),
            realm.invokeCallback(callbacks[0])
          ]);
          return closedWork;
        }
      }
    });
    try {
      await realm.evaluate("save(() => 1);");
      await expect(realm.evaluate("await stop();")).rejects.toBeDefined();
      expect((await closedWork).every((outcome) => outcome.status === "rejected")).toBe(true);
      await realm.close();
    } finally {
      await realm.close();
    }
  });

  it("reports cleanup failure only after releasing the canceled realm's budget", async () => {
    const budget = new Budget();
    const cleanup = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const { realm, callbacks } = fixture({
      budget,
      extensions: [
        defineExtension({
          manifest: { version: 1, name: "cleanup-failure" },
          setup(context) {
            context.onCleanup(cleanup);
            return {};
          }
        })
      ]
    });
    try {
      await realm.evaluate("save(async () => { await wait(); });");
      const invocation = realm.startCallback(callbacks[0]);
      const result = expect(invocation.result).rejects.toBeDefined();
      await invocation.synchronous;
      await expect(realm.close()).rejects.toThrow("Realm cleanup failed.");
      await result;
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(budget.currentDataSize).toBe(0);
      expect(budget.currentCallDepth).toBe(0);
      const replacement = createRealm({ budget });
      await replacement.close();
    } finally {
      await realm.close().catch(() => undefined);
    }
  });

  it("discards late module resolution after closing a source alongside a pending callback", async () => {
    const requested = deferred();
    const loaded = deferred<{ id: string; source: string }>();
    const effect = vi.fn();
    const budget = new Budget();
    const { realm, callbacks } = fixture({
      budget,
      bindings: { effect },
      sourceResolver: () => {
        requested.resolve();
        return loaded.promise;
      }
    });
    try {
      await realm.evaluate("save(async () => { await wait(); });");
      const invocation = realm.startCallback(callbacks[0]);
      const result = expect(invocation.result).rejects.toBeDefined();
      await invocation.synchronous;
      const source = realm.evaluate("import 'dep'; export const answer = 1;", {
        sourceType: "module"
      });
      const sourceResult = expect(source).rejects.toBeDefined();
      await requested.promise;
      await realm.close();
      await Promise.all([result, sourceResult]);
      loaded.resolve({ id: "dep", source: "effect(); export const value = 2;" });
      await loaded.promise;
      expect(effect).not.toHaveBeenCalled();
      expect(budget.currentDataSize).toBe(0);
      expect([...budget.retainedValues()]).toEqual([]);
    } finally {
      await realm.close();
    }
  });
});
