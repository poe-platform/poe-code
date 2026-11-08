import { describe, expect, it } from "vitest";
import { Budget, createRealm, defineExtension, run, type ExtensionContext } from "./core.js";

describe("retained guest arguments", () => {
  it("keeps independent references to the same value valid until each is released", async () => {
    let refs: unknown[] = [];
    const extension = defineExtension({
      manifest: {
        version: 1,
        name: "independent",
        capabilities: ["guest:retain"],
        globals: ["save", "read"]
      },
      setup(context) {
        return {
          globals: {
            save: context.retainGuestArguments((...values: unknown[]) => {
              refs = values;
            }, 0),
            read: () => refs[1]
          }
        };
      }
    });
    const realm = createRealm({ extensions: [extension], grants: ["guest:retain"] });
    try {
      await realm.evaluate("const object = {}; save(object, object);");
      expect(refs[0]).not.toBe(refs[1]);
      realm.releaseGuestReference(refs[0]);
      expect(await realm.evaluate("return read() === object;")).toMatchObject({
        ok: true,
        returnValue: true
      });
      realm.releaseGuestReference(refs[1]);
    } finally {
      await realm.close();
    }
  });

  it.each(["arrayLength", "dataSize"])(
    "cannot hide retained %s exhaustion in guest catch blocks",
    async (limit) => {
      const budget = new Budget(
        limit === "arrayLength" ? { arrayLength: 4 } : { dataSize: 40_000 }
      );
      const extension = defineExtension({
        manifest: { version: 1, name: "fatal", capabilities: ["guest:retain"], globals: ["save"] },
        setup(context) {
          return { globals: { save: context.retainGuestArguments(() => undefined, 0) } };
        }
      });
      const realm = createRealm({ extensions: [extension], grants: ["guest:retain"], budget });
      await expect(
        realm.evaluate(
          "for (let index = 0; index < 100; index++) { try { save({ data: 'x'.repeat(1000) }); } catch {} } return 1;"
        )
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: limit });
      await realm.close();
    }
  );

  it("rejects retained references inside native error data", async () => {
    const extension = defineExtension({
      manifest: {
        version: 1,
        name: "error-data",
        capabilities: ["guest:retain"],
        globals: ["fail"]
      },
      setup(context) {
        return {
          globals: {
            fail: context.retainGuestArguments((ref: unknown) => {
              throw new AggregateError([ref], "native failed");
            }, 0)
          }
        };
      }
    });
    const realm = createRealm({ extensions: [extension], grants: ["guest:retain"] });
    await expect(realm.evaluate("fail({});")).rejects.toThrow(/live capabilities/i);
    await realm.close();
  });

  it("rejects declaration changes after setup and conflicting capture indexes", async () => {
    let context!: ExtensionContext;
    const operation = () => undefined;
    const extension = defineExtension({
      manifest: { version: 1, name: "declarations", capabilities: ["guest:retain"] },
      setup(value) {
        context = value;
        context.retainGuestArguments(operation, 0);
        expect(() => context.retainGuestArguments(operation, 1)).toThrow(/conflict/i);
        return {};
      }
    });
    const realm = createRealm({ extensions: [extension], grants: ["guest:retain"] });
    try {
      await realm.evaluate("return 1;");
      expect(() => context.retainGuestArguments(() => undefined, 0)).toThrow(/setup/i);
    } finally {
      await realm.close();
    }
  });
  it("preserves deferred timer arguments, mutations and receiver identity", async () => {
    let callback: unknown;
    let args: unknown[] = [];
    const timers = defineExtension({
      manifest: {
        version: 1,
        name: "timers",
        capabilities: ["guest:retain"],
        globals: ["schedule"]
      },
      setup(context) {
        return {
          globals: {
            schedule: context.retainGuestArguments(
              (fn: unknown, delay: number, ...values: unknown[]) => {
                expect(delay).toBe(0);
                callback = fn;
                args = values;
              },
              2
            )
          }
        };
      }
    });
    const realm = createRealm({ extensions: [timers], grants: ["guest:retain"] });
    try {
      await realm.evaluate(
        "let argument = { value: 1 }; let identity; schedule(function(value) { identity = value === argument && this === argument; value.value++; }, 0, argument); argument.value = 7;"
      );
      expect(Object.getPrototypeOf(args[0])).toBeNull();
      expect(Reflect.ownKeys(args[0] as object)).toEqual([]);
      expect(Object.isFrozen(args[0])).toBe(true);
      await realm.invokeCallback(callback, { args, thisValue: args[0] });
      expect(await realm.evaluate("return [identity, argument.value];")).toMatchObject({
        ok: true,
        returnValue: [true, 8]
      });
      realm.releaseGuestReference(args[0]);
      await expect(realm.invokeCallback(callback, { args })).rejects.toThrow(/revoked/i);
    } finally {
      await realm.close();
    }
  });

  it("preserves cycles, closures, primitives and live objects through host methods", async () => {
    const refs: unknown[] = [];
    const extension = defineExtension({
      manifest: { version: 1, name: "values", capabilities: ["guest:retain"], globals: ["host"] },
      setup(context) {
        const host = context.createHostObject({
          methods: {
            capture: context.retainGuestArguments((value: unknown) => {
              refs.push(value);
              return value;
            }, 0)
          }
        });
        return { globals: { host } };
      }
    });
    const realm = createRealm({ extensions: [extension], grants: ["guest:retain"] });
    try {
      expect(
        await realm.evaluate(
          "const object = {}; object.self = object; const fn = () => 9; return [host.capture(object) === object, host.capture(fn) === fn, host.capture(fn)(), host.capture(host) === host, host.capture(undefined), host.capture(null), host.capture(3), host.capture('yes')];"
        )
      ).toMatchObject({ ok: true, returnValue: [true, true, 9, true, undefined, null, 3, "yes"] });
      for (const ref of refs) realm.releaseGuestReference(ref);
    } finally {
      await realm.close();
    }
  });

  it("keeps leading arguments and unmarked operations copied", async () => {
    const extension = defineExtension({
      manifest: {
        version: 1,
        name: "copy",
        capabilities: ["guest:retain"],
        globals: ["mixed", "copy"]
      },
      setup(context) {
        return {
          globals: {
            mixed: context.retainGuestArguments((leading: { value: number }, retained: unknown) => {
              leading.value = 99;
              return retained;
            }, 1),
            copy: (value: { value: number }) => {
              value.value = 99;
              return value;
            }
          }
        };
      }
    });
    const realm = createRealm({ extensions: [extension], grants: ["guest:retain"] });
    try {
      expect(
        await realm.evaluate(
          "const object = { value: 1 }; return [mixed(object, object) === object, copy(object) === object, object.value];"
        )
      ).toMatchObject({ ok: true, returnValue: [true, false, 1] });
    } finally {
      await realm.close();
    }
  });

  it("requires an explicit extension grant", async () => {
    const extension = defineExtension({
      manifest: { version: 1, name: "denied" },
      setup(context) {
        context.retainGuestArguments(() => undefined, 0);
        return {};
      }
    });
    const realm = createRealm({ extensions: [extension], grants: ["guest:retain"] });
    await expect(realm.evaluate("return 1;")).rejects.toThrow(/guest:retain/);
    await realm.close();
  });

  it.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid starting index %s",
    async (from) => {
      const extension = defineExtension({
        manifest: { version: 1, name: "invalid", capabilities: ["guest:retain"] },
        setup(context) {
          context.retainGuestArguments(() => undefined, from);
          return {};
        }
      });
      const realm = createRealm({ extensions: [extension], grants: ["guest:retain"] });
      await expect(realm.evaluate("return 1;")).rejects.toThrow(/index|integer/i);
      await realm.close();
    }
  );

  it("rolls back captures on synchronous native failure without revoking earlier references", async () => {
    const refs: unknown[] = [];
    const extension = defineExtension({
      manifest: {
        version: 1,
        name: "failure",
        capabilities: ["guest:retain"],
        globals: ["capture"]
      },
      setup(context) {
        return {
          globals: {
            capture: context.retainGuestArguments((fail: boolean, value: unknown) => {
              refs.push(value);
              if (fail) throw new Error("native failed");
            }, 1)
          }
        };
      }
    });
    const realm = createRealm({
      extensions: [extension],
      grants: ["guest:retain"],
      limits: { guestReferences: 2 }
    });
    try {
      expect(
        await realm.evaluate(
          "capture(false, {}); for (let index = 0; index < 10; index++) { try { capture(true, {}); } catch {} } return 1;"
        )
      ).toMatchObject({ ok: true, returnValue: 1 });
      expect(() => realm.releaseGuestReference(refs[1])).toThrow(/revoked/i);
      realm.releaseGuestReference(refs[0]);
    } finally {
      await realm.close();
    }
  });

  it("rejects foreign, stale and replay conversions", async () => {
    let ref: unknown;
    const extension = defineExtension({
      manifest: { version: 1, name: "owner", capabilities: ["guest:retain"], globals: ["save"] },
      setup(context) {
        return {
          globals: {
            save: context.retainGuestArguments((value: unknown) => {
              ref = value;
            }, 0)
          }
        };
      }
    });
    const owner = createRealm({ extensions: [extension], grants: ["guest:retain"] });
    await owner.evaluate("save({ value: 1 });");
    const foreign = createRealm({ bindings: { ref: ref as never } });
    await expect(foreign.evaluate("return ref;")).rejects.toThrow(/foreign/i);
    expect(() => foreign.releaseGuestReference(ref)).toThrow(/foreign/i);
    await expect(run("return ref;", { bindings: { ref: ref as never } })).rejects.toThrow(
      /live capabilities/i
    );
    await owner.close();
    expect(() => owner.releaseGuestReference(ref)).toThrow(/closed|revoked/i);
    await foreign.close();
  });

  it("counts detached retained data and releases its budget", async () => {
    let ref: unknown;
    let context!: ExtensionContext;
    const budget = new Budget({ maxSteps: 10_000, dataSize: 50_000 });
    const extension = defineExtension({
      manifest: { version: 1, name: "data", capabilities: ["guest:retain"], globals: ["save"] },
      setup(value) {
        context = value;
        return {
          globals: {
            save: context.retainGuestArguments((value: unknown) => {
              ref = value;
            }, 0)
          }
        };
      }
    });
    const realm = createRealm({ extensions: [extension], grants: ["guest:retain"], budget });
    try {
      await realm.evaluate("save({ content: 'x'.repeat(2000) });");
      const retained = budget.currentDataSize;
      context.releaseGuestReference(ref);
      expect(budget.currentDataSize).toBeLessThan(retained - 1900);
    } finally {
      await realm.close();
    }
  });

  it("enforces reference collection limits", async () => {
    const extension = defineExtension({
      manifest: { version: 1, name: "bounded", capabilities: ["guest:retain"], globals: ["save"] },
      setup(context) {
        return { globals: { save: context.retainGuestArguments(() => undefined, 0) } };
      }
    });
    const realm = createRealm({
      extensions: [extension],
      grants: ["guest:retain"],
      limits: { guestReferences: 2 }
    });
    try {
      await expect(realm.evaluate("save(1, 2, 3);")).rejects.toThrow(/guest reference limit/i);
    } finally {
      await realm.close();
    }
  });
});
