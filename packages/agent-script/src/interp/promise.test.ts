import { describe, expect, it } from "vitest";

import { Budget, SandboxError } from "./budget.js";
import { createPromiseGlobals } from "./promise.js";
import {
  createSandboxPromise,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxClosure,
  type SandboxObject
} from "./values.js";

describe("createPromiseGlobals", () => {
  it("exposes await-only subset Promise helpers", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    expect(resolveClosure(globals.Promise, "resolve").call(["value"])).toSatisfy(isSandboxPromise);
    expect(resolveClosure(globals.Promise, "reject").call(["boom"])).toSatisfy(isSandboxPromise);
    await expect(
      resolvePromise(resolveClosure(globals.Promise, "all").call([[1, createSandboxPromise(Promise.resolve(2))]]))
    ).resolves.toEqual([1, 2]);
    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "race").call([
          [createSandboxPromise(Promise.resolve("first")), createSandboxPromise(new Promise(() => undefined))]
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
    await expect(resolvePromise(resolveClosure(globals.Promise, "resolve").call(["ready"]))).resolves.toBe(
      "ready"
    );
    await expect(resolvePromise(resolveClosure(globals.Promise, "reject").call(["boom"]))).rejects.toBe(
      "boom"
    );
  });

  it("returns a subset AggregateError shape when Promise.any rejects", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(
      resolvePromise(
        resolveClosure(globals.Promise, "any").call([
          [createSandboxPromise(Promise.reject("left")), createSandboxPromise(Promise.reject("right"))]
        ])
      )
    ).rejects.toEqual({
      errors: ["left", "right"],
      message: "All promises were rejected",
      name: "AggregateError"
    });
  });

  it("matches host Promise behavior for empty iterables", async () => {
    const globals = createPromiseGlobals({
      budget: new Budget()
    });

    await expect(resolvePromise(resolveClosure(globals.Promise, "all").call([[]]))).resolves.toEqual([]);
    await expect(resolvePromise(resolveClosure(globals.Promise, "allSettled").call([[]]))).resolves.toEqual([]);
    await expect(resolvePromise(resolveClosure(globals.Promise, "any").call([[]]))).rejects.toEqual({
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

    await expect(resolvePromise(resolveClosure(globals.Promise, "all").call(["ab"]))).resolves.toEqual(["a", "b"]);
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

    await expect(resolvePromise(resolveClosure(globals.Promise, "all").call([123]))).rejects.toThrow(
      "Promise helpers require an array or string iterable."
    );
    await expect(resolvePromise(resolveClosure(globals.Promise, "race").call([undefined]))).rejects.toThrow(
      "Promise helpers require an array or string iterable."
    );
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
        resolveClosure(stringBudgetGlobals.Promise, "allSettled").call([[createSandboxPromise(Promise.resolve(1))]])
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

    await expect(resolvePromise(resolveClosure(resolveGlobals.Promise, "resolve").call(["ready"]))).rejects.toEqual(
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

function resolveClosure(value: SandboxObject, name: string): SandboxClosure {
  const closure = value[name];

  if (!isSandboxClosure(closure)) {
    throw new TypeError(`Expected Promise.${name} to be a sandbox closure.`);
  }

  return closure;
}

async function resolvePromise(value: unknown): Promise<unknown> {
  if (!isSandboxPromise(value)) {
    throw new TypeError("Expected a subset Promise value.");
  }

  return value.promise;
}
