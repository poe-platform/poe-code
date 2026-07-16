import { describe, expect, it, vi } from "vitest";

import { run } from "../run.js";
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
  it("copies non-enumerable static methods from injected functions", () => {
    const wrapped = wrapCallerInjectedBindings(
      {
        AbortSignal
      },
      { budget: new Budget() }
    ).AbortSignal as SandboxClosure;

    expect(wrapped.properties).toMatchObject({
      any: expect.objectContaining({
        kind: "fn"
      })
    });
  });

  it("converts host Map and Set results into sandbox collections", () => {
    const shared = { id: 1 };
    const wrapped = wrapCallerInjectedBindings(
      {
        load() {
          return new Map([[shared, new Set([shared])]]);
        }
      },
      { budget: new Budget() }
    ).load as SandboxClosure;

    const result = wrapped.call([]) as import("./values.js").SandboxMap;
    expect(result).toMatchObject({ kind: "map" });
    const [key, value] = [...result.entries][0] ?? [];
    expect(value).toMatchObject({ kind: "set" });
    expect([...(value as import("./values.js").SandboxSet).values][0]).toBe(key);
  });

  it("preserves cycles while converting host Map and Set results", () => {
    const hostMap = new Map<unknown, unknown>();
    const hostSet = new Set<unknown>();
    hostMap.set("self", hostMap);
    hostMap.set("set", hostSet);
    hostSet.add(hostMap);

    const wrapped = wrapCallerInjectedBindings(
      {
        load() {
          return hostMap;
        }
      },
      { budget: new Budget() }
    ).load as SandboxClosure;

    const result = wrapped.call([]) as import("./values.js").SandboxMap;
    const set = result.entries.get("set") as import("./values.js").SandboxSet;
    expect(result.entries.get("self")).toBe(result);
    expect([...set.values]).toEqual([result]);
  });

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

  it("passes sandbox objects to host functions as deep copies", () => {
    let observedInput: { nested: { value: number } } | undefined;
    const wrapped = wrapCallerInjectedBindings(
      {
        host(input: { nested: { value: number } }) {
          observedInput = input;
          return input.nested.value;
        }
      },
      {
        budget: new Budget()
      }
    ).host as SandboxClosure;
    const sandboxInput = deepCopyToSandbox({
      nested: {
        value: 1
      }
    }) as SandboxObject;

    const result = wrapped.call([sandboxInput]);

    expect(result).toBe(1);
    expect(observedInput).toEqual({
      nested: {
        value: 1
      }
    });
    expect(observedInput).not.toBe(sandboxInput);
    expect(observedInput?.nested).not.toBe(sandboxInput.nested);
  });

  it("keeps sandbox values unchanged when host mutates its deep copy", () => {
    const wrapped = wrapCallerInjectedBindings(
      {
        host(input: { nested: { value: number } }) {
          input.nested.value = 2;
          return input;
        }
      },
      {
        budget: new Budget()
      }
    ).host as SandboxClosure;
    const sandboxInput = deepCopyToSandbox({
      nested: {
        value: 1
      }
    }) as SandboxObject;

    const result = wrapped.call([sandboxInput]);

    expect(sandboxInput).toEqual({
      nested: {
        value: 1
      }
    });
    expect(result).toEqual({
      nested: {
        value: 2
      }
    });
  });

  it("copies host-returned objects into fresh sandbox objects", () => {
    const hostObject = {
      nested: {
        value: 1
      }
    };
    const wrapped = wrapCallerInjectedBindings(
      {
        host() {
          return hostObject;
        }
      },
      {
        budget: new Budget()
      }
    ).host as SandboxClosure;

    const result = wrapped.call([]);

    expect(result).toEqual(hostObject);
    expect(result).not.toBe(hostObject);
    expect((result as SandboxObject).nested).not.toBe(hostObject.nested);
  });

  it("copies both sides when host returns the same input object and does not preserve identity", () => {
    let observedInput: { value: number } | undefined;
    const wrapped = wrapCallerInjectedBindings(
      {
        host(input: { value: number }) {
          observedInput = input;
          return input;
        }
      },
      {
        budget: new Budget()
      }
    ).host as SandboxClosure;
    const sandboxInput = deepCopyToSandbox({
      value: 1
    }) as SandboxObject;

    const result = wrapped.call([sandboxInput]);

    expect(observedInput).toEqual({
      value: 1
    });
    expect(observedInput).not.toBe(sandboxInput);
    expect(result).toEqual({
      value: 1
    });
    expect(result).not.toBe(sandboxInput);
    expect(result).not.toBe(observedInput);
  });

  it.each([
    ["undefined", undefined],
    ["null", null]
  ] as const)("copies host-returned %s into the sandbox", (_name, value) => {
    const wrapped = wrapCallerInjectedBindings(
      {
        host() {
          return value;
        }
      },
      {
        budget: new Budget()
      }
    ).host as SandboxClosure;

    expect(wrapped.call([])).toBe(value);
  });

  it("documents returned host functions as sandbox closures", () => {
    const wrapped = wrapCallerInjectedBindings(
      {
        host() {
          return (value: number) => value + 1;
        }
      },
      {
        budget: new Budget()
      }
    ).host as SandboxClosure;

    const returned = wrapped.call([]);

    expect(typeof returned).toBe("object");
    expect((returned as SandboxClosure).kind).toBe("fn");
    expect((returned as SandboxClosure).call([1])).toBe(2);
  });

  it("lets sandbox code catch synchronous host throws at the call site", async () => {
    const result = await run(
      [
        "try {",
        "  explode();",
        "} catch ({ name, message }) {",
        "  return name + ':' + message;",
        "}"
      ].join("\n"),
      {
        bindings: {
          explode() {
            throw new TypeError("boom");
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: "TypeError:boom"
    });
  });

  it("lets sandbox code catch rejected host promises at the await site", async () => {
    const result = await run(
      [
        "try {",
        "  await explode();",
        "} catch ({ name, message }) {",
        "  return name + ':' + message;",
        "}"
      ].join("\n"),
      {
        bindings: {
          async explode() {
            throw new RangeError("async boom");
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: "RangeError:async boom"
    });
  });

  it("surfaces allowlisted host error metadata to sandbox catch blocks", async () => {
    const result = await run(
      [
        "try {",
        "  await copyFile();",
        "} catch (error) {",
        "  return [error.code, error.errno, error.syscall, error.path, error.dest].join('|');",
        "}"
      ].join("\n"),
      {
        bindings: {
          async copyFile() {
            throw Object.assign(
              new Error("ENOENT: no such file or directory, copyfile 'a.txt' -> 'b.txt'"),
              {
                code: "ENOENT",
                errno: -2,
                syscall: "copyfile",
                path: "a.txt",
                dest: "b.txt"
              }
            );
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: "ENOENT|-2|copyfile|a.txt|b.txt"
    });
  });

  it("omits host error metadata the allowlist does not cover", async () => {
    const result = await run(
      [
        "try {",
        "  await explode();",
        "} catch (error) {",
        "  return typeof error.secret;",
        "}"
      ].join("\n"),
      {
        bindings: {
          async explode() {
            throw Object.assign(new Error("boom"), { code: "EACCES", secret: "token" });
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: "undefined"
    });
  });

  it("omits allowlisted host error metadata whose type does not match", async () => {
    const result = await run(
      [
        "try {",
        "  await explode();",
        "} catch (error) {",
        "  return typeof error.code + ':' + typeof error.errno;",
        "}"
      ].join("\n"),
      {
        bindings: {
          async explode() {
            throw Object.assign(new Error("boom"), { code: 42, errno: "-2" });
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: "undefined:undefined"
    });
  });

  it("keeps non-Error host rejections free of metadata", async () => {
    const result = await run(
      [
        "try {",
        "  await explode();",
        "} catch (error) {",
        "  return error.message + ':' + typeof error.code;",
        "}"
      ].join("\n"),
      {
        bindings: {
          async explode() {
            throw { code: "ENOENT", message: "plain rejection" };
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: "plain rejection:undefined"
    });
  });

  it("surfaces host error metadata rejected from a nested host module function", async () => {
    const result = await run(
      [
        "try {",
        "  await fs.readFile('a.txt');",
        "} catch (error) {",
        "  return [error.code, error.errno, error.syscall, error.path].join('|');",
        "}"
      ].join("\n"),
      {
        bindings: {
          fs: {
            async readFile() {
              throw Object.assign(new Error("ENOENT: no such file or directory, open 'a.txt'"), {
                code: "ENOENT",
                errno: -2,
                syscall: "open",
                path: "a.txt"
              });
            }
          }
        }
      }
    );

    expect(result).toMatchObject({ ok: true, returnValue: "ENOENT|-2|open|a.txt" });
  });

  it("surfaces host error metadata from synchronous host throws", async () => {
    const result = await run(
      ["try {", "  boom();", "} catch (error) {", "  return error.code;", "}"].join("\n"),
      {
        bindings: {
          boom() {
            throw Object.assign(new Error("nope"), { code: "EACCES" });
          }
        }
      }
    );

    expect(result).toMatchObject({ ok: true, returnValue: "EACCES" });
  });

  it("keeps the original host error when metadata is exposed through an accessor", async () => {
    const result = await run(
      [
        "try {",
        "  await explode();",
        "} catch (error) {",
        "  return error.message + ':' + typeof error.code;",
        "}"
      ].join("\n"),
      {
        bindings: {
          async explode() {
            const error = new Error("original host failure");
            Object.defineProperty(error, "code", {
              enumerable: true,
              get() {
                throw new Error("accessor side effect");
              }
            });
            throw error;
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: "original host failure:undefined"
    });
  });

  it("rejects in-flight host promises when the host bridge signal aborts", async () => {
    const controller = new AbortController();
    const wrapped = wrapCallerInjectedBindings(
      {
        wait() {
          return new Promise(() => undefined);
        }
      },
      {
        budget: new Budget(),
        signal: controller.signal
      }
    ).wait as SandboxClosure;

    const result = wrapped.call([], {
      stack: ["    at wait (line 1, column 7)"]
    });
    controller.abort(new Error("stop waiting"));

    expect(isSandboxPromise(result)).toBe(true);
    await expect(result.promise).rejects.toEqual({
      name: "Error",
      message: "stop waiting",
      stack: "Error: stop waiting\n    at wait (line 1, column 7)"
    });
  });

  it.each([
    [
      "stringLength",
      new Budget({
        stringLength: 4
      }),
      "12345",
      {
        budget: "stringLength",
        current: 5,
        limit: 4
      }
    ],
    [
      "arrayLength",
      new Budget({
        arrayLength: 1
      }),
      [1, 2],
      {
        budget: "arrayLength",
        current: 2,
        limit: 1
      }
    ]
  ] as const)("applies %s budget to host-returned values", (_name, budget, value, expected) => {
    const wrapped = wrapCallerInjectedBindings(
      {
        host() {
          return value;
        }
      },
      {
        budget
      }
    ).host as SandboxClosure;

    expect(() => wrapped.call([])).toThrow(
      expect.objectContaining({
        code: "budgetExceeded",
        ...expected
      })
    );
  });

  it("wraps host errors with no message field into readable sandbox errors", () => {
    const thrown = Object.create(null) as { name: string };
    thrown.name = "HostFailure";
    const wrapped = wrapCallerInjectedBindings(
      {
        explode() {
          throw thrown;
        }
      },
      {
        budget: new Budget()
      }
    ).explode as SandboxClosure;

    expect(() =>
      wrapped.call([], {
        stack: ["    at explode (line 1, column 7)"]
      })
    ).toThrow(
      expect.objectContaining({
        name: "Error",
        message: "HostFailure",
        stack: "Error: HostFailure\n    at explode (line 1, column 7)"
      })
    );
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

  it("prefers named default-export callables in subset stacks", () => {
    function fail() {
      throw new Error("stop now");
    }

    const wrapped = wrapCallerInjectedBindings(
      {
        default: fail
      },
      {
        budget: new Budget()
      }
    ).default as SandboxClosure;

    try {
      wrapped.call([], {
        stack: ["    at fail (line 3, column 3)"]
      });
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toEqual({
        name: "Error",
        message: "stop now",
        stack: "Error: stop now\n    at fail (line 3, column 3)"
      });
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
