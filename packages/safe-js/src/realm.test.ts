import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension, run, type ExtensionContext } from "./core.js";

describe("persistent realms", () => {
  it("preserves both setup and cleanup errors in a one-shot run", async () => {
    const setupError = new Error("setup failed");
    const cleanupError = new Error("cleanup failed");
    const cleanup = vi.fn(() => {
      throw cleanupError;
    });
    const extension = defineExtension({
      manifest: { version: 1, name: "failed-run" },
      setup(context) {
        context.onCleanup(cleanup);
        throw setupError;
      }
    });
    const failure = await run("return 1;", { extensions: [extension] }).catch((error) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toContain(setupError);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("runs a deferred callback while guest code awaits its result", async () => {
    let callback: unknown;
    let ready!: () => void;
    const scheduled = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const realm = createRealm({
      bindings: {
        schedule: (value: unknown) => {
          callback = value;
          ready();
        }
      }
    });
    const execution = realm.evaluate(
      "return await new Promise(resolve => schedule(() => resolve(7)));"
    );
    void execution.catch(() => undefined);
    try {
      await scheduled;
      await realm.invokeCallback(callback);
      expect(await execution).toMatchObject({ ok: true, returnValue: 7 });
    } finally {
      await realm.close();
    }
  });

  it.each(["bindings", "modules"])(
    "rejects foreign callbacks entering through %s",
    async (entry) => {
      let callback: unknown;
      const first = createRealm({
        bindings: {
          save: (value: unknown) => {
            callback = value;
          }
        }
      });
      await first.evaluate("let calls = 0; save(() => ++calls);");
      const second = createRealm(
        entry === "bindings"
          ? { bindings: { callback: callback as never } }
          : { modules: { foreign: { callback: callback as never } } }
      );
      try {
        await expect(
          second.evaluate(
            entry === "bindings"
              ? "return callback();"
              : "import { callback } from 'foreign'; return callback();"
          )
        ).rejects.toThrow(/foreign/i);
        expect(await first.evaluate("return calls;")).toMatchObject({ ok: true, returnValue: 0 });
      } finally {
        await first.close();
        await second.close();
      }
    }
  );

  it("retains declarations, closures and object identity without replay", async () => {
    const effect = vi.fn();
    const realm = createRealm({ bindings: { effect }, budget: new Budget({ maxSteps: 1000 }) });
    try {
      expect(
        await realm.evaluate(
          "effect(); const object = { value: 1 }; const alias = object; function increment() { return ++object.value; }"
        )
      ).toMatchObject({ ok: true });
      expect(await realm.evaluate("return [increment(), alias === object];")).toMatchObject({
        ok: true,
        returnValue: [2, true]
      });
      expect(await realm.evaluate("return increment();")).toMatchObject({
        ok: true,
        returnValue: 3
      });
      expect(effect).toHaveBeenCalledTimes(1);
    } finally {
      await realm.close();
    }
  });

  it("lazily creates independent extension state and composes module exports", async () => {
    const setup = vi.fn(() => {
      let value = 0;
      return { globals: { increment: () => ++value }, modules: { counter: { read: () => value } } };
    });
    const extension = defineExtension({
      manifest: {
        version: 1,
        name: "counter",
        capabilities: ["state"],
        globals: ["increment"],
        modules: { counter: ["read"] }
      },
      setup
    });
    const options = { extensions: [extension], grants: ["state"] };
    const unused = createRealm(options);
    await unused.close();
    expect(setup).not.toHaveBeenCalled();
    const first = createRealm(options);
    const second = createRealm(options);
    try {
      await first.evaluate("increment();");
      expect(await first.evaluate("import { read } from 'counter'; return read();")).toMatchObject({
        ok: true,
        returnValue: 1
      });
      expect(await second.evaluate("import { read } from 'counter'; return read();")).toMatchObject(
        { ok: true, returnValue: 0 }
      );
      expect(setup).toHaveBeenCalledTimes(2);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("checks versions, grants and conflicts before setup", () => {
    const setup = vi.fn(() => ({ globals: { value: 1 } }));
    const definition = {
      manifest: {
        version: 1 as const,
        name: "sample",
        capabilities: ["state"],
        globals: ["value"]
      },
      setup
    };
    const extension = defineExtension(definition);
    expect(() =>
      defineExtension({ ...definition, manifest: { ...definition.manifest, version: 2 as never } })
    ).toThrow(/version/i);
    expect(() => createRealm({ extensions: [extension] })).toThrow(/grant/i);
    expect(() => createRealm({ extensions: [extension, extension], grants: ["state"] })).toThrow(
      /duplicate/i
    );
    expect(() =>
      createRealm({ extensions: [extension], grants: ["state"], bindings: { value: 2 } })
    ).toThrow(/conflict/i);
    const intrinsic = defineExtension({
      manifest: { version: 1, name: "intrinsic", globals: ["Math"] },
      setup: () => ({ globals: { Math: {} } })
    });
    expect(() => createRealm({ extensions: [intrinsic] })).toThrow(/conflict/i);
    expect(setup).not.toHaveBeenCalled();
  });

  it("does not execute accessor-based declarations", () => {
    const getter = vi.fn(() => "unsafe");
    const manifest = Object.defineProperty({ version: 1 }, "name", {
      get: getter,
      enumerable: true
    });
    expect(() => defineExtension({ manifest: manifest as never, setup: () => ({}) })).toThrow(
      /data|accessor/i
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("awaits every cleanup in reverse order after partial setup failure", async () => {
    const events: string[] = [];
    const first = defineExtension({
      manifest: { version: 1, name: "first" },
      setup(context) {
        context.onCleanup(async () => {
          await Promise.resolve();
          events.push("first");
        });
        return {};
      }
    });
    const second = defineExtension({
      manifest: { version: 1, name: "second" },
      setup(context) {
        context.onCleanup(async () => {
          events.push("second");
          throw new Error("cleanup failure");
        });
        throw new Error("setup failure");
      }
    });
    const realm = createRealm({ extensions: [first, second] });
    await expect(realm.evaluate("return 1;")).rejects.toThrow(/setup|cleanup/i);
    expect(events).toEqual(["second", "first"]);
    await expect(realm.close()).rejects.toThrow(/cleanup/i);
    expect(events).toEqual(["second", "first"]);
  });

  it("rejects evaluation after idempotent close", async () => {
    const realm = createRealm();
    await realm.close();
    await realm.close();
    await expect(realm.evaluate("return 1;")).rejects.toThrow(/closed/i);
  });

  it("supports explicit live properties, methods and stable identity", async () => {
    const extension = defineExtension({
      manifest: { version: 1, name: "dom", capabilities: ["dom"], globals: ["node", "sameNode"] },
      setup(context) {
        let value = 1;
        const node = context.createHostObject({
          properties: {
            value: {
              get: () => value,
              set: (next) => {
                value = Number(next);
              }
            }
          },
          methods: { increment: () => ++value }
        });
        return { globals: { node, sameNode: () => node } };
      }
    });
    const realm = createRealm({ extensions: [extension], grants: ["dom"] });
    try {
      expect(
        await realm.evaluate(
          "node.value = 7; return [node.increment(), node === sameNode(), node.constructor, node.__proto__];"
        )
      ).toMatchObject({ ok: true, returnValue: [8, true, undefined, undefined] });
      expect(await realm.evaluate("return node.value;")).toMatchObject({
        ok: true,
        returnValue: 8
      });
    } finally {
      await realm.close();
    }
  });

  it("retains callbacks with their guest state and live receiver, then revokes them", async () => {
    let callback: unknown;
    let node: unknown;
    const realm = createRealm({
      extensions: [
        defineExtension({
          manifest: { version: 1, name: "events", globals: ["listen", "node"] },
          setup(context) {
            node = context.createHostObject({ properties: { value: { get: () => 7 } } });
            return {
              globals: {
                node,
                listen: (value: unknown) => {
                  callback = value;
                }
              }
            };
          }
        })
      ]
    });
    await realm.evaluate(
      "let count = 0; listen(function (amount) { count += amount; return [count, this === node, this.value]; });"
    );
    expect(await realm.invokeCallback(callback, { thisValue: node, args: [2] })).toEqual([
      2,
      true,
      7
    ]);
    expect(await realm.invokeCallback(callback, { thisValue: node, args: [3] })).toEqual([
      5,
      true,
      7
    ]);
    await realm.close();
    await expect(realm.invokeCallback(callback)).rejects.toThrow(/closed|revoked/i);
  });

  it("keeps ordinary copied host arguments unchanged", async () => {
    const realm = createRealm({
      bindings: {
        mutate: (value: { count: number }) => {
          value.count = 9;
        }
      }
    });
    try {
      expect(
        await realm.evaluate("const value = { count: 1 }; mutate(value); return value.count;")
      ).toMatchObject({ ok: true, returnValue: 1 });
    } finally {
      await realm.close();
    }
  });

  it("does not allow native code to swallow a fatal work budget", async () => {
    const extension = defineExtension({
      manifest: { version: 1, name: "work", globals: ["work"] },
      setup(context) {
        return {
          globals: {
            work: () => {
              try {
                context.chargeWork(1000);
              } catch (error) {
                expect(error).toMatchObject({ code: "budgetExceeded" });
              }
              return 1;
            }
          }
        };
      }
    });
    const realm = createRealm({ extensions: [extension], budget: new Budget({ maxSteps: 200 }) });
    await expect(realm.evaluate("try { work(); } catch {} return 2;")).rejects.toMatchObject({
      code: "budgetExceeded"
    });
    await expect(realm.evaluate("return 3;")).rejects.toThrow();
    await realm.close();
  });

  it("runs authorized nested source before the enclosing guest call returns", async () => {
    const extension = defineExtension({
      manifest: { version: 1, name: "parser", capabilities: ["source:nested"], globals: ["write"] },
      setup(context) {
        return {
          globals: {
            write: context.nestedOperation(async (source: string) => {
              await context.evaluateNested(source);
            })
          }
        };
      }
    });
    const realm = createRealm({ extensions: [extension], grants: ["source:nested"] });
    try {
      expect(
        await realm.evaluate(
          "let value = 0; const object = {}; write('value = 1; const alias = object;'); return [value, alias === object];"
        )
      ).toMatchObject({ ok: true, returnValue: [1, true] });
    } finally {
      await realm.close();
    }
  });

  it("rejects unauthorized source reentry", async () => {
    const realm = createRealm({ bindings: { reenter: () => realm.evaluate("return 1;") } });
    await expect(realm.evaluate("await reenter();")).rejects.toThrow(/reentry|already running/i);
    await realm.close();
  });

  it("composes the same extensions with one-shot run and disposes them", async () => {
    const cleanup = vi.fn();
    const extension = defineExtension({
      manifest: { version: 1, name: "one-shot", globals: ["answer"] },
      setup(context) {
        context.onCleanup(cleanup);
        return { globals: { answer: () => 42 } };
      }
    });
    expect(await run("return answer();", { extensions: [extension] })).toMatchObject({
      ok: true,
      returnValue: 42
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("rejects accessor-based registration arrays without reading them", () => {
    const getter = vi.fn();
    const registrations = Object.defineProperty([], "0", { get: getter });
    expect(() => createRealm({ extensions: registrations })).toThrow(/data|accessor/i);
    expect(getter).not.toHaveBeenCalled();
  });

  it("refuses async factories before they acquire resources", () => {
    const acquire = vi.fn();
    expect(() =>
      defineExtension({
        manifest: { version: 1, name: "async" },
        setup: (async () => {
          acquire();
          return {};
        }) as never
      })
    ).toThrow(/synchronous/i);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("rejects foreign and released guest callbacks", async () => {
    let callback: unknown;
    const first = createRealm({
      bindings: {
        save: (value: unknown) => {
          callback = value;
        }
      }
    });
    const second = createRealm();
    try {
      await first.evaluate("save(() => 7);");
      await expect(second.invokeCallback(callback)).rejects.toThrow(/foreign/i);
      first.releaseCallback(callback);
      await expect(first.invokeCallback(callback)).rejects.toThrow(/revoked/i);
      expect(await first.evaluate("return 1;")).toMatchObject({ ok: true, returnValue: 1 });
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("rejects foreign live objects and ordinary-run imports", async () => {
    const extension = defineExtension({
      manifest: { version: 1, name: "object", globals: ["node"] },
      setup: (context) => ({ globals: { node: context.createHostObject({}) } })
    });
    const first = createRealm({ extensions: [extension] });
    const result = await first.evaluate("return node;");
    if (!result.ok) throw new Error("Realm failed");
    const second = createRealm({ bindings: { node: result.returnValue as never } });
    await expect(second.evaluate("return node;")).rejects.toThrow(/foreign/i);
    await expect(
      run("return node;", { bindings: { node: result.returnValue as never } })
    ).rejects.toThrow(/live capabilities/i);
    await first.close();
    await second.close();
  });

  it("cannot swallow collection exhaustion in trusted host code", async () => {
    const extension = defineExtension({
      manifest: { version: 1, name: "objects", globals: ["allocate"] },
      setup(context) {
        return {
          globals: {
            allocate: () => {
              try {
                for (let index = 0; index < 20; index++) context.createHostObject({});
              } catch (error) {
                expect(error).toMatchObject({ code: "budgetExceeded" });
              }
            }
          }
        };
      }
    });
    const realm = createRealm({ extensions: [extension], budget: new Budget({ arrayLength: 4 }) });
    await expect(realm.evaluate("allocate(); return 1;")).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "arrayLength"
    });
    await realm.close();
  });

  it("cancels an active callback and awaits cleanup before close settles", async () => {
    let callback: unknown;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const cleanup = vi.fn();
    const realm = createRealm({
      extensions: [
        defineExtension({
          manifest: { version: 1, name: "pending", globals: ["save", "pending"] },
          setup(context) {
            context.onCleanup(async () => {
              await Promise.resolve();
              cleanup();
            });
            return {
              globals: {
                save: (value: unknown) => {
                  callback = value;
                },
                pending: () => {
                  started();
                  return new Promise(() => {});
                }
              }
            };
          }
        })
      ]
    });
    await realm.evaluate("save(async () => { await pending(); return 1; });");
    const invocation = realm.invokeCallback(callback);
    const rejected = expect(invocation).rejects.toThrow(/closed|aborted/i);
    await entered;
    await realm.close();
    await rejected;
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("bounds nested source recursion", async () => {
    const extension = defineExtension({
      manifest: {
        version: 1,
        name: "recursive",
        capabilities: ["source:nested"],
        globals: ["nested"]
      },
      setup(context) {
        return {
          globals: { nested: context.nestedOperation(() => context.evaluateNested("nested();")) }
        };
      }
    });
    const realm = createRealm({
      extensions: [extension],
      grants: ["source:nested"],
      limits: { nestedEvaluations: 3 }
    });
    await expect(realm.evaluate("try { nested(); } catch {} return 1;")).rejects.toThrow(
      /nested|budget/i
    );
    await realm.close();
  });

  it("rejects concurrent nested evaluations from one native invocation", async () => {
    const extension = defineExtension({
      manifest: {
        version: 1,
        name: "concurrent",
        capabilities: ["source:nested"],
        globals: ["nested"]
      },
      setup(context) {
        return {
          globals: {
            nested: context.nestedOperation(async () => {
              await Promise.all([
                context.evaluateNested("value += 1;"),
                context.evaluateNested("value += 2;")
              ]);
            })
          }
        };
      }
    });
    const realm = createRealm({ extensions: [extension], grants: ["source:nested"] });
    await expect(realm.evaluate("let value = 0; nested(); return value;")).rejects.toThrow(
      /reentry|already running/i
    );
    await realm.close();
  });

  it("does not lend nested-source authority to another extension context", async () => {
    let other!: ExtensionContext;
    const passive = defineExtension({
      manifest: { version: 1, name: "passive" },
      setup(context) {
        other = context;
        return {};
      }
    });
    const authorized = defineExtension({
      manifest: {
        version: 1,
        name: "authorized",
        capabilities: ["source:nested"],
        globals: ["nested"]
      },
      setup(context) {
        return {
          globals: { nested: context.nestedOperation(() => other.evaluateNested("value = 9;")) }
        };
      }
    });
    const realm = createRealm({ extensions: [passive, authorized], grants: ["source:nested"] });
    await expect(realm.evaluate("let value = 0; nested(); return value;")).rejects.toThrow(
      /reentry|grant|authorized|already running/i
    );
    await realm.close();
  });

  it("releases unreachable captured data with its callback", async () => {
    let callback: unknown;
    const budget = new Budget({ dataSize: 20_000 });
    const realm = createRealm({
      budget,
      bindings: {
        save: (value: unknown) => {
          callback = value;
        }
      }
    });
    await realm.evaluate(
      "save((() => { const data = Array(1000).fill(1); return () => data.length; })());"
    );
    const before = budget.currentDataSize;
    realm.releaseCallback(callback);
    expect(budget.currentDataSize).toBeLessThan(before - 500);
    await realm.close();
  });

  it("reports unhandled guest rejections and disposes resources", async () => {
    const cleanup = vi.fn();
    const extension = defineExtension({
      manifest: { version: 1, name: "rejection" },
      setup(context) {
        context.onCleanup(cleanup);
        return {};
      }
    });
    const realm = createRealm({ extensions: [extension] });
    await expect(realm.evaluate("Promise.reject('bad'); return 1;")).rejects.toThrow(
      /unhandled.*bad/i
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    await realm.close();
  });

  it("does not return raw executable state from a one-shot extension run", async () => {
    const cleanup = vi.fn();
    const extension = defineExtension({
      manifest: { version: 1, name: "one-shot-callback" },
      setup(context) {
        context.onCleanup(cleanup);
        return {};
      }
    });
    await expect(run("return () => 1;", { extensions: [extension] })).rejects.toThrow(
      /data|capability|callable|closure/i
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported realm and extension-run options instead of ignoring them", async () => {
    expect(() => createRealm({ snapshot: {} } as never)).toThrow(/option|snapshot/i);
    const extension = defineExtension({
      manifest: { version: 1, name: "options" },
      setup: () => ({})
    });
    await expect(
      run("return 1;", { extensions: [extension], importMeta: { value: 7 } })
    ).rejects.toThrow(/option|importMeta/i);
  });

  it("waits for nested source even when the native handler returns no promise", async () => {
    const extension = defineExtension({
      manifest: { version: 1, name: "write", capabilities: ["source:nested"], globals: ["write"] },
      setup(context) {
        return {
          globals: {
            write: context.nestedOperation(() => {
              void context.evaluateNested("for (let index = 0; index < 10; index++) value += 1;");
            })
          }
        };
      }
    });
    const realm = createRealm({ extensions: [extension], grants: ["source:nested"] });
    try {
      expect(await realm.evaluate("let value = 0; write(); return value;")).toMatchObject({
        ok: true,
        returnValue: 10
      });
    } finally {
      await realm.close();
    }
  });
});
