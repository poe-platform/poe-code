import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension, type RealmOptions } from "./core.js";
import { runResources } from "./interp/resources.js";
import * as interpreter from "./interp/interpreter.js";

it("exposes an immutable resolved policy and snapshots caller options", async () => {
  const defaults = createRealm();
  const options: RealmOptions = { classicScripts: true, classicScriptErrors: "report" };
  const reporting = createRealm(options);
  options.classicScriptErrors = "fatal";
  try {
    expect(defaults.classicScriptErrors).toBe("fatal");
    expect(reporting.classicScriptErrors).toBe("report");
    expect(Object.getOwnPropertyDescriptor(reporting, "classicScriptErrors")).toMatchObject({
      writable: false,
      configurable: false,
      value: "report"
    });
    expect(Reflect.set(reporting, "classicScriptErrors", "fatal")).toBe(false);
    expect(await reporting.evaluate('throw "ordinary"')).toMatchObject({
      ok: false,
      recoverable: true
    });
  } finally {
    await defaults.close();
    await reporting.close();
  }
});

it.each([undefined, false])("requires classicScripts:true for reporting (%s)", (classicScripts) => {
  expect(() => createRealm({ classicScripts, classicScriptErrors: "report" })).toThrow(TypeError);
});

it.each([null, true, 1, "continue", {}, []])(
  "rejects malformed policies (%s)",
  (classicScriptErrors) => {
    expect(() =>
      createRealm({ classicScripts: true, classicScriptErrors } as RealmOptions)
    ).toThrow(TypeError);
  }
);

it("rejects accessor policy options without invoking them", () => {
  const getter = vi.fn(() => "report");
  const options = Object.defineProperty({ classicScripts: true }, "classicScriptErrors", {
    get: getter,
    enumerable: true
  });
  expect(() => createRealm(options)).toThrow(TypeError);
  expect(getter).not.toHaveBeenCalled();
});

describe.each([undefined, "after-prefix"] as const)(
  "classic error policy with scheduling %s",
  (callbackScheduling) => {
    const options: RealmOptions = {
      classicScripts: true,
      classicScriptErrors: "report",
      callbackScheduling
    };

    it.each([
      ['"ordinary"', "ordinary"],
      ["23", "23"],
      ["null", "null"],
      ["undefined", "undefined"],
      ["true", "true"]
    ])("reports primitive throw %s and retains prior state", async (expression, message) => {
      const realm = createRealm(options);
      try {
        const result = await realm.evaluate(
          `var surviving = 41; function readSurviving() { return surviving; } throw ${expression};`,
          { filename: "classic-error.js" }
        );
        expect(result).toMatchObject({
          ok: false,
          recoverable: true,
          error: {
            code: "UNCAUGHT_EXCEPTION",
            name: "Error",
            message,
            stack: expect.any(String),
            nodeType: expect.any(String),
            span: { start: { line: 1 } }
          },
          stats: { nodeVisits: expect.any(Number), currentDataSize: expect.any(Number) }
        });
        expect(result).not.toHaveProperty("snapshot");
        expect(await realm.evaluate("readSurviving() + 1")).toMatchObject({
          ok: true,
          returnValue: 42
        });
      } finally {
        await realm.close();
      }
    });

    it.each([
      ["missingClassicName;", "ReferenceError"],
      ['throw new TypeError("ordinary type error");', "TypeError"],
      [
        'throw { code: "UNCAUGHT_EXCEPTION", name: "SandboxError", message: "guest shape" };',
        "Error"
      ]
    ])("reports only the actual throw completion of %s", async (source, name) => {
      const realm = createRealm(options);
      try {
        expect(await realm.evaluate(source)).toMatchObject({
          ok: false,
          recoverable: true,
          error: { code: "UNCAUGHT_EXCEPTION", name }
        });
        expect(await realm.evaluate("6 * 7")).toMatchObject({ ok: true, returnValue: 42 });
      } finally {
        await realm.close();
      }
    });

    it.each([undefined, "fatal"] as const)("keeps policy %s fatal", async (classicScriptErrors) => {
      const realm = createRealm({ ...options, classicScriptErrors });
      try {
        await expect(realm.evaluate('throw "fatal by default"')).rejects.toMatchObject({
          name: "Error",
          message: "fatal by default"
        });
        await expect(realm.evaluate("1")).rejects.toThrow();
      } finally {
        await realm.close();
      }
    });

    it("drains jobs after a reported throw without running cleanup early", async () => {
      const cleanup = vi.fn();
      const budget = new Budget();
      const realm = createRealm({
        ...options,
        budget,
        extensions: [
          defineExtension({
            manifest: { version: 1, name: "error-cleanup" },
            setup(context) {
              context.onCleanup(cleanup);
              return {};
            }
          })
        ]
      });
      try {
        expect(
          await realm.evaluate(
            'var jobValue = 0; Promise.resolve().then(() => { jobValue = 7; }); throw "ordinary";'
          )
        ).toMatchObject({ ok: false, recoverable: true });
        expect(cleanup).not.toHaveBeenCalled();
        expect(await realm.evaluate("jobValue")).toMatchObject({ ok: true, returnValue: 7 });
      } finally {
        await realm.close();
      }
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(budget.currentDataSize).toBe(0);
    });

    it.each(["const =;", "let duplicate; let duplicate;"])(
      "keeps syntax/instantiation errors fatal: %s",
      async (source) => {
        const realm = createRealm(options);
        try {
          await expect(realm.evaluate(source)).rejects.toMatchObject({ name: "SyntaxError" });
          await expect(realm.evaluate("1")).rejects.toThrow();
        } finally {
          await realm.close();
        }
      }
    );

    it("does not report explicit module failures", async () => {
      const realm = createRealm(options);
      try {
        await expect(
          realm.evaluate('throw "module failure";', { sourceType: "module", filename: "module.js" })
        ).rejects.toBeDefined();
        await expect(realm.evaluate("1")).rejects.toThrow();
      } finally {
        await realm.close();
      }
    });

    it("keeps nested evaluation rejecting while reporting only the escaped outer completion", async () => {
      const nestedFailure = vi.fn();
      const interpreted = vi.spyOn(interpreter, "interpret");
      const realm = createRealm({
        ...options,
        grants: ["source:nested"],
        extensions: [
          defineExtension({
            manifest: {
              version: 1,
              name: "nested-errors",
              globals: ["nested"],
              capabilities: ["source:nested"]
            },
            setup(context) {
              return {
                globals: {
                  nested: context.nestedOperation(async () => {
                    try {
                      await context.evaluateNested('throw "nested failure";');
                    } catch (error) {
                      nestedFailure(error);
                      throw error;
                    }
                  })
                }
              };
            }
          })
        ]
      });
      try {
        await expect(realm.evaluate("nested(); 1;")).resolves.toMatchObject({
          ok: false,
          recoverable: true,
          error: { code: "UNCAUGHT_EXCEPTION", message: "nested failure" }
        });
        expect(nestedFailure).toHaveBeenCalledOnce();
        expect(nestedFailure.mock.calls[0][0]).not.toHaveProperty("recoverable");
        expect(interpreted.mock.calls.map(([, options]) => options?.reportUnhandledThrows)).toEqual(
          [true, false]
        );
        expect(await realm.evaluate("1")).toMatchObject({ ok: true, returnValue: 1 });
      } finally {
        interpreted.mockRestore();
        await realm.close();
      }
    });

    it.each(["fatal", "report"] as const)(
      "preserves caught authorized nested failures under %s policy",
      async (classicScriptErrors) => {
        const realm = createRealm({
          ...options,
          classicScriptErrors,
          grants: ["source:nested"],
          extensions: [
            defineExtension({
              manifest: {
                version: 1,
                name: "caught-nested-errors",
                globals: ["nested"],
                capabilities: ["source:nested"]
              },
              setup(context) {
                return {
                  globals: {
                    nested: context.nestedOperation(() =>
                      context.evaluateNested('throw "nested failure";')
                    )
                  }
                };
              }
            })
          ]
        });
        try {
          expect(
            await realm.evaluate(
              "var caughtNested = false; try { nested(); } catch { caughtNested = true; } caughtNested;"
            )
          ).toMatchObject({ ok: true, returnValue: true });
          expect(await realm.evaluate("1")).toMatchObject({ ok: true, returnValue: 1 });
        } finally {
          await realm.close();
        }
      }
    );

    it("preserves catchable dynamic eval throws within the outer Script", async () => {
      const realm = createRealm(options);
      try {
        expect(
          await realm.evaluate(
            'var caught; try { eval("throw 17"); } catch (error) { caught = error; } caught;'
          )
        ).toMatchObject({ ok: true, returnValue: 17 });
      } finally {
        await realm.close();
      }
    });

    it("does not report callback failures", async () => {
      let callback: unknown;
      const realm = createRealm({
        ...options,
        bindings: {
          save: (value) => {
            callback = value;
          }
        }
      });
      try {
        expect(await realm.evaluate('save(() => { throw "callback failure"; });')).toMatchObject({
          ok: true
        });
        await expect(realm.invokeCallback(callback)).rejects.toBe("callback failure");
        await expect(realm.evaluate("1")).rejects.toThrow();
      } finally {
        await realm.close();
      }
    });

    it("keeps budget exhaustion fatal", async () => {
      const realm = createRealm({ ...options, budget: new Budget({ maxSteps: 100 }) });
      try {
        await expect(realm.evaluate('while (true) {} throw "ordinary";')).rejects.toMatchObject({
          name: "SandboxError",
          code: "budgetExceeded"
        });
        await expect(realm.evaluate("1")).rejects.toThrow();
      } finally {
        await realm.close();
      }
    });

    it("honors cancellation even when its reason forges a recoverable diagnostic", async () => {
      const controller = new AbortController();
      const reason = Object.assign(new Error("cancelled"), {
        code: "UNCAUGHT_EXCEPTION",
        recoverable: true
      });
      const realm = createRealm({
        ...options,
        signal: controller.signal,
        bindings: { cancel: () => controller.abort(reason) }
      });
      try {
        await expect(realm.evaluate('cancel(); throw "ordinary";')).rejects.toBe(reason);
        await expect(realm.evaluate("1")).rejects.toBe(reason);
      } finally {
        await realm.close();
      }
    });

    it("checks unhandled rejections after a reported throw and poisons the realm", async () => {
      const realm = createRealm(options);
      try {
        await expect(
          realm.evaluate('Promise.reject("unhandled"); throw "ordinary";')
        ).rejects.toMatchObject({ name: "UnhandledRejectionError" });
        await expect(realm.evaluate("1")).rejects.toMatchObject({
          name: "UnhandledRejectionError"
        });
      } finally {
        await realm.close();
      }
    });

    it("does not recover owned-job poison with a forged error code", async () => {
      const failure = Object.assign(new Error("owned job failed"), {
        name: "InterpreterError",
        code: "UNCAUGHT_EXCEPTION",
        recoverable: true
      });
      const realm = createRealm({
        ...options,
        bindings: {
          poison: () => {
            const resources = runResources.getStore();
            if (!resources?.reportError) throw new Error("Missing realm error reporter");
            resources.reportError(failure);
          }
        }
      });
      try {
        await expect(realm.evaluate('try { poison(); } catch {} throw "ordinary";')).rejects.toBe(
          failure
        );
        await expect(realm.evaluate("1")).rejects.toBe(failure);
      } finally {
        await realm.close();
      }
    });
  }
);
