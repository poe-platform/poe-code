import { describe, expect, it, vi } from "vitest";

import { Budget, SandboxError } from "./budget.js";
import { SandboxJobQueue } from "./jobs.js";
import { createPromiseGlobals, getPromiseMember, resolveSandboxValue } from "./promise.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

describe("createPromiseGlobals", () => {
  it.each(["budgetExceeded", "reentry"])(
    "propagates %s during adoption without an active rejection tracker",
    async (code) => {
      const budget = new Budget();
      createPromiseGlobals({ budget });
      const error = new SandboxError(
        code === "reentry" ? "reentry" : { budget: "callDepth", current: 9, limit: 8 }
      );
      const failed = createSandboxPromise(Promise.reject(error));
      const result = resolveSandboxValue(failed, { budget });
      const outcome = await Promise.race([
        result.then(
          (value) => ({ value }),
          (reason: unknown) => ({ reason })
        ),
        new Promise((resolve) => setImmediate(() => resolve("pending")))
      ]);
      expect(outcome).toEqual({ reason: error });
    }
  );

  it("does not pass an argument to iterator next during aggregation", async () => {
    const calls: number[] = [];
    const iterable = {
      [Symbol.iterator]() {
        return {
          next(...args: unknown[]) {
            calls.push(args.length);
            return { done: true, value: undefined };
          }
        };
      }
    };
    await Promise.all(iterable);
    const expected = calls.splice(0);
    const globals = createPromiseGlobals({ budget: new Budget() });
    await resolvePromise(resolveClosure(globals.Promise, "all").call([iterable as never]));
    expect(calls).toEqual(expected);
  });

  it("captures the iterator next method once like native aggregation", async () => {
    const createIterable = () => ({
      [Symbol.iterator]() {
        let index = 0;
        const iterator: Iterator<number> = {
          next() {
            index++;
            iterator.next = () => ({ done: true, value: undefined });
            return index <= 2 ? { done: false, value: index } : { done: true, value: undefined };
          }
        };
        return iterator;
      }
    });
    const globals = createPromiseGlobals({ budget: new Budget() });
    await expect(
      resolvePromise(resolveClosure(globals.Promise, "all").call([createIterable() as never]))
    ).resolves.toEqual(await Promise.all(createIterable()));
  });

  it("does not read iterator return during normal consumption", async () => {
    const iterable = {
      [Symbol.iterator]() {
        return {
          next: () => ({ done: true, value: undefined }),
          get return() {
            throw new Error("return must not be read");
          }
        };
      }
    };
    const globals = createPromiseGlobals({ budget: new Budget() });
    await expect(
      resolvePromise(resolveClosure(globals.Promise, "all").call([iterable as never]))
    ).resolves.toEqual(await Promise.all(iterable));
  });

  it.each([false, true])(
    "closes an iterator using its current return method when allocation fails (%s)",
    async (throws) => {
      const close = vi.fn(() => {
        if (throws) throw new Error("close failure");
        return { done: true, value: undefined };
      });
      const iterable = {
        [Symbol.iterator]() {
          const iterator: Iterator<number> = {
            next() {
              iterator.return = close;
              return { done: false, value: 1 };
            }
          };
          return iterator;
        }
      };
      const globals = createPromiseGlobals({ budget: new Budget({ arrayLength: 0 }) });
      await expect(
        resolvePromise(resolveClosure(globals.Promise, "all").call([iterable as never]))
      ).rejects.toMatchObject({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "arrayLength"
      });
      expect(close).toHaveBeenCalledTimes(1);
    }
  );

  it.each(
    ["resolve", "reject"].flatMap((first) =>
      ["resolve", "reject", "throw"].map((second) => ({ first, second }))
    )
  )("keeps the first $first when a thenable later calls $second", async ({ first, second }) => {
    const value = createThenable((resolve, reject) => {
      if (first === "resolve") resolve("first");
      else reject("first");
      if (second === "resolve") resolve("second");
      else if (second === "reject") reject("second");
      else throw new Error("second");
    });
    const settled = resolveSandboxValue(value);
    if (first === "resolve") await expect(settled).resolves.toBe("first");
    else await expect(settled).rejects.toBe("first");
  });

  it("passes the thenable as its method receiver", async () => {
    const value: SandboxObject = {
      answer: 42,
      then: createSandboxClosure({
        call: ([resolve], context) => {
          if (!isSandboxClosure(resolve)) throw new TypeError("Expected resolver");
          return resolve.call([(context?.thisValue as SandboxObject | undefined)?.answer]);
        }
      })
    };
    await expect(resolveSandboxValue(value)).resolves.toBe(42);
  });

  it("assimilates callable thenables and preserves their receiver", async () => {
    const value = createSandboxClosure({
      call: () => undefined,
      properties: {
        answer: 42,
        then: createSandboxClosure({
          call: ([resolve], context) => {
            if (!isSandboxClosure(resolve)) throw new TypeError("Expected resolver");
            const receiver = context?.thisValue;
            return resolve.call([
              isSandboxClosure(receiver) ? receiver.properties?.answer : undefined
            ]);
          }
        })
      }
    });
    await expect(resolveSandboxValue(value)).resolves.toBe(42);
  });

  it("ignores late settlement errors from interpreter-style asynchronous invocation", async () => {
    const value: SandboxObject = {
      then: createSandboxClosure({
        call: async ([resolve, reject]) => {
          if (!isSandboxClosure(resolve) || !isSandboxClosure(reject))
            throw new TypeError("Expected resolvers");
          await resolve.call([42]);
          await reject.call(["ignored"]);
          throw new Error("ignored throw");
        }
      })
    };
    await expect(resolveSandboxValue(value)).resolves.toBe(42);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it.each(["resolve", "reject"])(
    "contains budget failures during queued thenable %s",
    async (settle) => {
      const callbacks: (() => void)[] = [];
      const microtask = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => {
        callbacks.push(callback);
      });
      try {
        let finish!: (value: SandboxValue) => void;
        const pending = resolveSandboxValue(
          createThenable((resolve, reject) => {
            finish = settle === "resolve" ? resolve : reject;
          }),
          { budget: new Budget({ stringLength: 1 }) }
        );
        const rejected = expect(pending).rejects.toMatchObject({
          name: "SandboxError",
          code: "budgetExceeded"
        });
        await new Promise((resolve) => setImmediate(resolve));
        finish("too large");
        expect(callbacks).toHaveLength(1);
        expect(() => callbacks[0]()).not.toThrow();
        await rejected;
      } finally {
        microtask.mockRestore();
      }
    }
  );

  it("resolves Promise.all empty iterables to an empty array after a microtask", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });
    const promise = resolvePromise(resolveClosure(globals.Promise, "all").call([[]]));
    let settled = false;

    promise.then(() => {
      settled = true;
    });

    expect(settled).toBe(false);
    await expect(promise).resolves.toEqual([]);
    expect(settled).toBe(true);
  });

  it("resolves Promise.all values and promises", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "all").call([
          [1, 2, createSandboxPromise(Promise.resolve(3))]
        ])
      )
    ).resolves.toEqual([1, 2, 3]);
  });

  it("rejects Promise.all on one rejection while later inputs still run", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });
    const afterReject = vi.fn();
    const later = createSandboxPromise(
      Promise.resolve().then(() => {
        afterReject();
        return "ignored";
      })
    );

    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "all").call([
          [createSandboxPromise(Promise.reject("first")), later]
        ])
      )
    ).rejects.toBe("first");
    await later.promise;

    expect(afterReject).toHaveBeenCalledTimes(1);
  });

  it("preserves Promise.all input order", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });
    const slow = createSandboxPromise(
      new Promise((resolve) => {
        queueMicrotask(() => resolve("slow"));
      })
    );
    const fast = createSandboxPromise(Promise.resolve("fast"));

    await expect(
      resolvePromise(resolveClosure(globals.Promise, "all").call([[slow, fast]]))
    ).resolves.toEqual(["slow", "fast"]);
  });

  it("keeps Promise.race empty iterables pending", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });
    const pendingRace = resolvePromise(resolveClosure(globals.Promise, "race").call([[]]));

    await expect(
      Promise.race([
        pendingRace.then(
          () => "settled",
          () => "settled"
        ),
        Promise.resolve("pending")
      ])
    ).resolves.toBe("pending");
  });

  it("matches V8 microtask order for Promise.race reject then resolve", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "race").call([
          [createSandboxPromise(Promise.reject(1)), createSandboxPromise(Promise.resolve(2))]
        ])
      )
    ).rejects.toBe(1);
  });

  it("matches native Promise.race when a rejecting thenable competes with a settled promise", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });
    const expected = await Promise.race([
      { then: (_resolve: unknown, reject: (reason: string) => void) => reject("sync") },
      Promise.resolve("ignored")
    ]);

    await expect(
      resolvePromise(
        new SandboxJobQueue().run(() =>
          resolveClosure(globals.Promise, "race").call([
            [
              createThenable((_resolve, reject) => reject("sync")),
              createSandboxPromise(Promise.resolve("ignored"))
            ]
          ])
        )
      )
    ).resolves.toBe(expected);
  });

  it("resolves Promise.allSettled empty iterables to an empty array", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(resolveClosure(globals.Promise, "allSettled").call([[]]))
    ).resolves.toEqual([]);
  });

  it("returns Promise.allSettled fulfillment and rejection records per input", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "allSettled").call([
          [createSandboxPromise(Promise.resolve("ok")), createSandboxPromise(Promise.reject("no"))]
        ])
      )
    ).resolves.toEqual([
      {
        status: "fulfilled",
        value: "ok"
      },
      {
        reason: "no",
        status: "rejected"
      }
    ]);
  });

  it("rejects Promise.any empty iterables with an empty AggregateError shape", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(resolveClosure(globals.Promise, "any").call([[]]))
    ).rejects.toMatchObject({
      errors: [],
      message: "All promises were rejected",
      name: "AggregateError"
    });
  });

  it("aggregates all Promise.any rejection reasons", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "any").call([
          [
            createSandboxPromise(Promise.reject("left")),
            createSandboxPromise(Promise.reject("right"))
          ]
        ])
      )
    ).rejects.toMatchObject({
      errors: ["left", "right"],
      message: "All promises were rejected",
      name: "AggregateError"
    });
  });

  it("resolves Promise.any with the first fulfilled value", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "any").call([
          [
            createSandboxPromise(Promise.reject("left")),
            createSandboxPromise(Promise.resolve("right"))
          ]
        ])
      )
    ).resolves.toBe("right");
  });

  it.each(["all", "race", "allSettled", "any"])(
    "rejects Promise.%s with TypeError for non-iterable input",
    async (name) => {
      const globals = createPromiseGlobals({
        budget: new Budget()
      });

      await expect(
        resolvePromise(resolveClosure(globals.Promise, name).call([123]))
      ).rejects.toMatchObject({ name: "TypeError" });
    }
  );

  it.each(["all", "race", "allSettled", "any"])(
    "propagates iterator next throws for Promise.%s",
    async (name) => {
      const globals = createPromiseGlobals({
        budget: new Budget()
      });
      const failure = new Error("next failed");

      await expect(
        resolvePromise(
          resolveClosure(globals.Promise, name).call([createThrowingIterable(failure)])
        )
      ).rejects.toMatchObject({ name: failure.name, message: failure.message });
    }
  );

  it("resolves thenables in Promise.all inputs", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "all").call([
          [createThenable((resolve) => resolve("thenable"))]
        ])
      )
    ).resolves.toEqual(["thenable"]);
  });

  it("uses each occurrence of the same promise instance in Promise.all results", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });
    const promise = createSandboxPromise(Promise.resolve("same"));

    await expect(
      resolvePromise(resolveClosure(globals.Promise, "all").call([[promise, promise]]))
    ).resolves.toEqual(["same", "same"]);
  });

  it("exposes await-only subset Promise helpers", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    expect(resolveClosure(globals.Promise, "resolve").call(["value"])).toSatisfy(isSandboxPromise);
    expect(resolveClosure(globals.Promise, "reject").call(["boom"])).toSatisfy(isSandboxPromise);
    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "all").call([[1, createSandboxPromise(Promise.resolve(2))]])
      )
    ).resolves.toEqual([1, 2]);
    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "race").call([
          [
            createSandboxPromise(Promise.resolve("first")),
            createSandboxPromise(new Promise(() => undefined))
          ]
        ])
      )
    ).resolves.toBe("first");
    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "allSettled").call([
          [createSandboxPromise(Promise.resolve("ok")), createSandboxPromise(Promise.reject("no"))]
        ])
      )
    ).resolves.toEqual([
      {
        status: "fulfilled",
        value: "ok"
      },
      {
        reason: "no",
        status: "rejected"
      }
    ]);
    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "any").call([
          [createSandboxPromise(Promise.reject("no")), createSandboxPromise(Promise.resolve("yes"))]
        ])
      )
    ).resolves.toBe("yes");
    await expect(
      resolvePromise(resolveClosure(globals.Promise, "resolve").call(["ready"]))
    ).resolves.toBe("ready");
    await expect(
      resolvePromise(resolveClosure(globals.Promise, "reject").call(["boom"]))
    ).rejects.toBe("boom");
  });

  it("returns a subset AggregateError shape when Promise.any rejects", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "any").call([
          [
            createSandboxPromise(Promise.reject("left")),
            createSandboxPromise(Promise.reject("right"))
          ]
        ])
      )
    ).rejects.toMatchObject({
      errors: ["left", "right"],
      message: "All promises were rejected",
      name: "AggregateError"
    });
  });

  it("matches host Promise behavior for empty iterables", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(resolveClosure(globals.Promise, "all").call([[]]))
    ).resolves.toEqual([]);
    await expect(
      resolvePromise(resolveClosure(globals.Promise, "allSettled").call([[]]))
    ).resolves.toEqual([]);
    await expect(
      resolvePromise(resolveClosure(globals.Promise, "any").call([[]]))
    ).rejects.toMatchObject({
      errors: [],
      message: "All promises were rejected",
      name: "AggregateError"
    });

    const pendingRace = resolvePromise(resolveClosure(globals.Promise, "race").call([[]]));

    await expect(
      Promise.race([
        pendingRace.then(
          () => "settled",
          () => "settled"
        ),
        Promise.resolve("pending")
      ])
    ).resolves.toBe("pending");
  });

  it("accepts string iterables and preserves Promise.all ordering", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(resolveClosure(globals.Promise, "all").call(["ab"]))
    ).resolves.toEqual(["a", "b"]);
    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "all").call([
          [
            createSandboxPromise(
              new Promise((resolve) => {
                queueMicrotask(() => resolve(2));
              })
            ),
            1
          ]
        ])
      )
    ).resolves.toEqual([2, 1]);
  });

  it("rejects non-iterable Promise helper inputs", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(resolveClosure(globals.Promise, "all").call([123]))
    ).rejects.toThrow("Promise helpers require an iterable.");
    await expect(
      resolvePromise(resolveClosure(globals.Promise, "race").call([undefined]))
    ).rejects.toThrow("Promise helpers require an iterable.");
  });

  it("adopts subset Promises passed to Promise.resolve", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });
    const promise = createSandboxPromise(Promise.resolve("ready"));

    expect(resolveClosure(globals.Promise, "resolve").call([promise])).toBe(promise);
  });

  it("applies array and string budgets to produced Promise helper values", async () => {
    const arrayBudgetGlobals = createPromiseGlobals({
      budget: new Budget({
        arrayLength: 1
      })
    });
    const stringBudgetGlobals = createPromiseGlobals({
      budget: new Budget({
        stringLength: 8
      })
    });

    await expect(
      resolvePromise(
        resolveClosure(arrayBudgetGlobals.Promise, "all").call([
          [createSandboxPromise(Promise.resolve(1)), createSandboxPromise(Promise.resolve(2))]
        ])
      )
    ).rejects.toEqual(
      expect.objectContaining({
        budget: "arrayLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );
    await expect(
      resolvePromise(
        resolveClosure(stringBudgetGlobals.Promise, "allSettled").call([
          [createSandboxPromise(Promise.resolve(1))]
        ])
      )
    ).rejects.toEqual(
      expect.objectContaining({
        budget: "stringLength",
        current: 9,
        limit: 8
      } satisfies Partial<SandboxError>)
    );
  });

  it("applies budgets to Promise.resolve and Promise.reject results", async () => {
    const resolveGlobals = createPromiseGlobals({
      budget: new Budget({
        stringLength: 4
      })
    });
    const rejectGlobals = createPromiseGlobals({
      budget: new Budget({
        arrayLength: 1
      })
    });

    await expect(
      resolvePromise(resolveClosure(resolveGlobals.Promise, "resolve").call(["ready"]))
    ).rejects.toEqual(
      expect.objectContaining({
        budget: "stringLength",
        current: 5,
        limit: 4
      } satisfies Partial<SandboxError>)
    );
    await expect(
      resolvePromise(resolveClosure(rejectGlobals.Promise, "reject").call([[1, 2]]))
    ).rejects.toEqual(
      expect.objectContaining({
        budget: "arrayLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );
  });
});

describe("getPromiseMember", () => {
  it("recovers from rejection with catch", async () => {
    const recovered = callPromiseMember(createSandboxPromise(Promise.reject("failure")), "catch", [
      createSandboxClosure({
        call: ([reason]) => `recovered: ${String(reason)}`,
        name: "recover"
      })
    ]);

    await expect(recovered.promise).resolves.toBe("recovered: failure");
  });

  it("awaits an async catch handler", async () => {
    const recovered = callPromiseMember(createSandboxPromise(Promise.reject("failure")), "catch", [
      createSandboxClosure({
        async: true,
        call: () => createSandboxPromise(Promise.resolve("recovered")),
        name: "recover"
      })
    ]);

    await expect(recovered.promise).resolves.toBe("recovered");
  });

  it.each([
    { outcome: "fulfilled", promise: () => Promise.resolve("value") },
    { outcome: "rejected", promise: () => Promise.reject("reason") }
  ])("runs finally on $outcome and passes the outcome through", async ({ outcome, promise }) => {
    const onFinally = vi.fn(() => undefined);
    const settled = callPromiseMember(createSandboxPromise(promise()), "finally", [
      createSandboxClosure({
        call: (args) => {
          onFinally(args);
          return undefined;
        },
        name: "cleanup"
      })
    ]);

    if (outcome === "fulfilled") {
      await expect(settled.promise).resolves.toBe("value");
    } else {
      await expect(settled.promise).rejects.toBe("reason");
    }
    expect(onFinally).toHaveBeenCalledWith([]);
  });

  it("awaits async finally before propagating the original value", async () => {
    const order: string[] = [];
    const settled = callPromiseMember(createSandboxPromise(Promise.resolve("value")), "finally", [
      createSandboxClosure({
        async: true,
        call: () =>
          createSandboxPromise(
            Promise.resolve().then(() => {
              order.push("finally");
              return "ignored";
            })
          ),
        name: "cleanup"
      })
    ]);

    const result = settled.promise.then((value) => {
      order.push("settled");
      return value;
    });

    await expect(result).resolves.toBe("value");
    expect(order).toEqual(["finally", "settled"]);
  });

  it("rejects when finally throws", async () => {
    const failure = new Error("cleanup failed");
    const settled = callPromiseMember(createSandboxPromise(Promise.resolve("value")), "finally", [
      createSandboxClosure({
        call: () => {
          throw failure;
        },
        name: "cleanup"
      })
    ]);

    await expect(settled.promise).rejects.toBe(failure);
  });

  it("replaces the original rejection when async finally rejects", async () => {
    const settled = callPromiseMember(createSandboxPromise(Promise.reject("original")), "finally", [
      createSandboxClosure({
        async: true,
        call: () => createSandboxPromise(Promise.reject("cleanup failed")),
        name: "cleanup"
      })
    ]);

    await expect(settled.promise).rejects.toBe("cleanup failed");
  });

  it.each(["catch", "finally"])(
    "passes rejection through when %s has no closure handler",
    async (name) => {
      const settled = callPromiseMember(
        createSandboxPromise(Promise.reject("reason")),
        name,
        [123]
      );

      await expect(settled.promise).rejects.toBe("reason");
    }
  );

  it("shares intrinsic promise members within the execution budget", () => {
    const budget = new Budget();
    const globals = createPromiseGlobals({ budget });
    expect(getPromiseMember("then", budget)).toSatisfy(isSandboxClosure);
    expect(getPromiseMember("catch", budget)).toSatisfy(isSandboxClosure);
    expect(getPromiseMember("finally", budget)).toSatisfy(isSandboxClosure);
    expect(getPromiseMember("constructor", budget)).toBe(globals.Promise);
    expect(getPromiseMember("then", budget)).toBe(getPromiseMember("then", budget));
    expect(getPromiseMember("missing", budget)).toBeUndefined();
  });

  it("chains catch before finally", async () => {
    const order: string[] = [];
    const recovered = callPromiseMember(createSandboxPromise(Promise.reject("failure")), "catch", [
      createSandboxClosure({
        call: () => {
          order.push("catch");
          return "recovered";
        },
        name: "recover"
      })
    ]);
    const settled = callPromiseMember(recovered, "finally", [
      createSandboxClosure({
        call: () => {
          order.push("finally");
          return undefined;
        },
        name: "cleanup"
      })
    ]);

    await expect(settled.promise).resolves.toBe("recovered");
    expect(order).toEqual(["catch", "finally"]);
  });
});

function resolveClosure(value: SandboxObject | SandboxClosure, name: string): SandboxClosure {
  const closure = isSandboxClosure(value) ? value.properties?.[name] : value[name];

  if (!isSandboxClosure(closure)) {
    throw new TypeError(`Expected Promise.${name} to be a sandbox closure.`);
  }

  return closure;
}

async function resolvePromise(value: unknown): Promise<unknown> {
  value = await value;
  if (!isSandboxPromise(value)) {
    throw new TypeError("Expected a subset Promise value.");
  }

  return value.promise;
}

function callPromiseMember(
  target: ReturnType<typeof createSandboxPromise>,
  name: string,
  args: SandboxValue[]
): ReturnType<typeof createSandboxPromise> {
  const member = getPromiseMember(name, new Budget());
  if (!isSandboxClosure(member)) {
    throw new TypeError(`Expected Promise.${name} to be a sandbox closure.`);
  }

  const result = member.call(args, { stack: [], thisValue: target });
  if (!isSandboxPromise(result)) {
    throw new TypeError(`Expected Promise.${name} to return a sandbox promise.`);
  }

  return result;
}

function createThenable(
  settle: (resolve: (value: SandboxValue) => void, reject: (reason: SandboxValue) => void) => void
): SandboxObject {
  return {
    then: createSandboxClosure({
      call: ([resolve, reject]) => {
        if (!isSandboxClosure(resolve) || !isSandboxClosure(reject)) {
          throw new TypeError("Expected thenable handlers.");
        }

        settle(
          (value) => {
            resolve.call([value]);
          },
          (reason) => {
            reject.call([reason]);
          }
        );
        return undefined;
      },
      name: "then"
    })
  };
}

function createThrowingIterable(error: Error): SandboxObject {
  return {
    [Symbol.iterator]: () => ({
      next: () => {
        throw error;
      }
    })
  } as unknown as SandboxObject;
}
