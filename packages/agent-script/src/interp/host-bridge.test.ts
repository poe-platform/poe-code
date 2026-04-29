import { describe, expect, it, vi } from "vitest";

import { Budget } from "./budget.js";
import { wrapCallerInjectedBindings } from "./host-bridge.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  deepCopyToSandbox,
  isSandboxPromise,
  type SandboxClosure,
  type SandboxObject
} from "./values.js";

describe("host bridge", () => {
  it("deep-copies sandbox arguments into host values and copies host returns back", () => {
    const observedArgs: unknown[] = [];
    const host = vi.fn((input: { nested: { value: number } }, items: number[]) => {
      observedArgs.push([structuredClone(input), structuredClone(items)]);
      input.nested.value = 7;
      items.push(3);

      return {
        seen: input,
        items
      };
    });
    const wrapped = wrapCallerInjectedBindings(
      {
        host
      },
      {
        budget: new Budget()
      }
    ).host as SandboxClosure;
    const input = deepCopyToSandbox({
      nested: {
        value: 1
      }
    }) as SandboxObject;
    const items = deepCopyToSandbox([1, 2]) as number[];

    const result = wrapped.call([input, items]);

    expect(observedArgs).toEqual([
      [
        {
          nested: {
            value: 1
          }
        },
        [1, 2]
      ]
    ]);
    expect(host).toHaveBeenCalledTimes(1);
    expect(input).toEqual({
      nested: {
        value: 1
      }
    });
    expect(items).toEqual([1, 2]);
    expect(result).toEqual({
      seen: {
        nested: {
          value: 7
        }
      },
      items: [1, 2, 3]
    });
  });

  it("converts host throws into subset errors with sandbox-only stacks", () => {
    const wrapped = wrapCallerInjectedBindings(
      {
        explode() {
          throw new TypeError("boom");
        }
      },
      {
        budget: new Budget()
      }
    ).explode as SandboxClosure;

    try {
      wrapped.call([], {
        stack: ["    at explode (line 1, column 7)"]
      });
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toEqual({
        name: "TypeError",
        message: "boom",
        stack: "TypeError: boom\n    at explode (line 1, column 7)"
      });
      expect((error as { stack: string }).stack).not.toContain("host-bridge.test.ts");
    }
  });

  it("wraps async host functions as subset promises", async () => {
    const observedArgs: unknown[] = [];
    const load = vi.fn(async (input: { value: number }) => {
      observedArgs.push(structuredClone(input));
      input.value = 2;

      return {
        input
      };
    });
    const wrapped = wrapCallerInjectedBindings(
      {
        load
      },
      {
        budget: new Budget()
      }
    ).load as SandboxClosure;

    const result = wrapped.call([
      deepCopyToSandbox({
        value: 1
      })
    ]);

    expect(isSandboxPromise(result)).toBe(true);
    expect(observedArgs).toEqual([
      {
        value: 1
      }
    ]);
    await expect(result.promise).resolves.toEqual({
      input: {
        value: 2
      }
    });
  });

  it("wraps sandbox callbacks passed into host calls and re-enters them under the same budget", async () => {
    const budget = new Budget({
      maxSteps: 1
    });
    const wrapped = wrapCallerInjectedBindings(
      {
        async inspect(callback: (value: number) => Promise<number>) {
          const first = await callback(1);

          try {
            await callback(2);
            return {
              first,
              second: "ok"
            };
          } catch (error) {
            return {
              first,
              second:
                error instanceof Error
                  ? {
                      budget: "budget" in error ? error.budget : undefined,
                      current: "current" in error ? error.current : undefined,
                      limit: "limit" in error ? error.limit : undefined,
                      message: error.message,
                      name: error.name
                    }
                  : error
            };
          }
        }
      },
      {
        budget
      }
    ).inspect as SandboxClosure;

    const result = wrapped.call(
      [
        createSandboxClosure({
          async: true,
          call: ([value]) => {
            budget.visitNode();
            return value;
          },
          name: "callback"
        })
      ],
      {
        stack: ["    at inspect (line 1, column 7)"]
      }
    );

    expect(isSandboxPromise(result)).toBe(true);
    await expect(result.promise).resolves.toEqual({
      first: 1,
      second: {
        budget: "steps",
        current: 2,
        limit: 1,
        message: "Sandbox budget exceeded for steps: 2 > 1.",
        name: "SandboxError"
      }
    });
  });

  it("copies callback rejection reasons back to host values, including nested closures", async () => {
    const wrapped = wrapCallerInjectedBindings(
      {
        async inspect(callback: (value: number) => Promise<unknown>) {
          try {
            await callback(1);
            return "ok";
          } catch (error) {
            const retry = (error as { retry?: unknown }).retry;

            return {
              retryType: typeof retry,
              retried:
                typeof retry === "function"
                  ? await (retry as (value: number) => Promise<number>)(3)
                  : null
            };
          }
        }
      },
      {
        budget: new Budget()
      }
    ).inspect as SandboxClosure;

    const result = wrapped.call([
      createSandboxClosure({
        async: true,
        call: () =>
          createSandboxPromise(
            Promise.reject({
              retry: createSandboxClosure({
                async: true,
                call: ([value]) => value,
                name: "retry"
              })
            })
          ),
        name: "callback"
      })
    ]);

    expect(isSandboxPromise(result)).toBe(true);
    await expect(result.promise).resolves.toEqual({
      retryType: "function",
      retried: 3
    });
  });

  it("converts async copy failures into subset errors when host results cannot enter sandbox space", async () => {
    const wrapped = wrapCallerInjectedBindings(
      {
        async load() {
          return new Date("2026-04-28T12:00:00Z");
        }
      },
      {
        budget: new Budget()
      }
    ).load as SandboxClosure;

    const result = wrapped.call([], {
      stack: ["    at load (line 1, column 7)"]
    });

    expect(isSandboxPromise(result)).toBe(true);
    await expect(result.promise).rejects.toEqual({
      name: "TypeError",
      message: "Unsupported sandbox value at <root>: Date",
      stack: "TypeError: Unsupported sandbox value at <root>: Date\n    at load (line 1, column 7)"
    });
  });
});
