import { describe, expect, it, vi } from "vitest";
import {
  Budget,
  createRealm,
  defineExtension,
  type RealmOptions,
  type SafeJSRealm
} from "./core.js";

describe("opt-in public classic Scripts", () => {
  it("retains a cold chunk expression without invoking its registered factory", async () => {
    const executed = vi.fn();
    const realm = createRealm({ classicScripts: true, bindings: { executed } });
    try {
      expect(
        await realm.evaluate(
          "(this.webpackChunkzoom=this.webpackChunkzoom||[]).push([[962],{19776(){executed();}}]);"
        )
      ).toMatchObject({ ok: true });
      expect(
        await realm.evaluate(
          "const originalRegistry = this.webpackChunkzoom; const originalFactory = originalRegistry[0][1][19776];"
        )
      ).toMatchObject({ ok: true });
      expect(
        await realm.evaluate(`
        globalThis.webpackChunkzoom.push([[963], {}]);
        [this.webpackChunkzoom === originalRegistry,
          this.webpackChunkzoom[0][1][19776] === originalFactory,
          typeof originalFactory, originalRegistry.length, originalRegistry[0][0][0]]
      `)
      ).toMatchObject({ ok: true, returnValue: [true, true, "function", 2, 962] });
      expect(executed).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("retains the host filename in a classic Script syntax diagnostic", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      await expect(
        realm.evaluate("const =;", { filename: "client-cold-chunk.js" })
      ).rejects.toMatchObject({ name: "SyntaxError", filename: "client-cold-chunk.js" });
    } finally {
      await realm.close();
    }
  });

  it.each(["var hostValue;", "let hostValue;", "function hostValue() {}"])(
    "rejects declarations that collide with injected capabilities: %s",
    async (source) => {
      const effect = vi.fn();
      const realm = createRealm({ classicScripts: true, bindings: { hostValue: 7, effect } });
      try {
        await expect(realm.evaluate(`effect(); ${source}`)).rejects.toMatchObject({
          name: "SyntaxError"
        });
        expect(effect).not.toHaveBeenCalled();
      } finally {
        await realm.close();
      }
    }
  );

  it.each([false, true])(
    "uses the intrinsic global receiver in a Script (strict: %s)",
    async (strict) => {
      const realm = createRealm({ classicScripts: true });
      try {
        expect(
          await realm.evaluate(`${strict ? '"use strict";' : ""}this === globalThis`)
        ).toMatchObject({ ok: true, returnValue: true });
      } finally {
        await realm.close();
      }
    }
  );

  it.each([false, true])(
    "creates nondeletable global var and function properties (strict: %s)",
    async (strict) => {
      const realm = createRealm({ classicScripts: true });
      try {
        expect(
          await realm.evaluate(`
        ${strict ? '"use strict";' : ""}
        var publicValue = 3;
        function readPublicValue() { return publicValue; }
        [globalThis.publicValue, globalThis.readPublicValue === readPublicValue,
          Object.getOwnPropertyDescriptor(globalThis, "publicValue").configurable,
          Object.getOwnPropertyDescriptor(globalThis, "readPublicValue").configurable]
      `)
        ).toMatchObject({ ok: true, returnValue: [3, true, false, false] });
        expect(
          await realm.evaluate(`
        globalThis.publicValue = 8;
        [readPublicValue(), delete globalThis.publicValue,
          delete globalThis.readPublicValue, publicValue, typeof readPublicValue]
      `)
        ).toMatchObject({ ok: true, returnValue: [8, false, false, 8, "function"] });
      } finally {
        await realm.close();
      }
    }
  );

  it("keeps bare function bindings identical to global properties through later redeclaration", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(
        await realm.evaluate(`
        const originalFactory = exportedFactory;
        function exportedFactory() { return 1; }
        [originalFactory === exportedFactory, exportedFactory === globalThis.exportedFactory,
          exportedFactory()]
      `)
      ).toMatchObject({ ok: true, returnValue: [true, true, 1] });
      expect(
        await realm.evaluate(`
        const replacementFactory = exportedFactory;
        function exportedFactory() { return 2; }
        [exportedFactory === globalThis.exportedFactory, replacementFactory === exportedFactory,
          exportedFactory === originalFactory, exportedFactory(), originalFactory(),
          Object.getOwnPropertyDescriptor(globalThis, "exportedFactory").configurable]
      `)
      ).toMatchObject({ ok: true, returnValue: [true, true, false, 2, 1, false] });
      expect(
        await realm.evaluate(`
        [replacementFactory === exportedFactory, globalThis.exportedFactory(), originalFactory()]
      `)
      ).toMatchObject({ ok: true, returnValue: [true, 2, 1] });
    } finally {
      await realm.close();
    }
  });

  it("retains lexical bindings and const immutability without creating global properties", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(
        await realm.evaluate(`
        let retainedCount = 1;
        const retainedToken = { value: 7 };
        function readRetained() { return [retainedCount, retainedToken.value]; }
      `)
      ).toMatchObject({ ok: true });
      expect(
        await realm.evaluate(`
        retainedCount += 2;
        retainedToken.value += 1;
        let assignmentError;
        try { retainedToken = {}; } catch (error) { assignmentError = error.name; }
        [readRetained(), Object.hasOwn(globalThis, "retainedCount"),
          Object.hasOwn(globalThis, "retainedToken"), assignmentError]
      `)
      ).toMatchObject({ ok: true, returnValue: [[3, 8], false, false, "TypeError"] });
      expect(await realm.evaluate("readRetained()")).toMatchObject({
        ok: true,
        returnValue: [3, 8]
      });
    } finally {
      await realm.close();
    }
  });

  it.each([
    { setup: "let locked = 1", source: "var locked" },
    { setup: "const locked = 1", source: "function locked() {}" },
    { setup: "var locked = 1", source: "let locked" },
    { setup: "let locked = 1", source: "const locked = 2" }
  ])(
    "rejects a later conflicting declaration before execution: $source after $setup",
    async ({ setup, source }) => {
      const effect = vi.fn();
      const realm = createRealm({ classicScripts: true, bindings: { effect } });
      try {
        expect(await realm.evaluate(setup)).toMatchObject({ ok: true });
        await expect(realm.evaluate(`effect(); ${source};`)).rejects.toMatchObject({
          name: "SyntaxError"
        });
        expect(effect).not.toHaveBeenCalled();
      } finally {
        await realm.close();
      }
    }
  );

  it("retains registry, array and factory identity without replay or eager factory calls", async () => {
    const registered = vi.fn();
    const executed = vi.fn();
    const realm = createRealm({ classicScripts: true, bindings: { registered, executed } });
    try {
      expect(
        await realm.evaluate(`
        var registry = {};
        var chunks = [];
        function factory() { executed(); return chunks; }
        registry.main = factory;
        chunks.push(["main", registry]);
        const originalRegistry = registry;
        const originalChunks = chunks;
        const originalFactory = factory;
        registered();
      `)
      ).toMatchObject({ ok: true });
      expect(registered).toHaveBeenCalledTimes(1);
      expect(executed).not.toHaveBeenCalled();
      expect(
        await realm.evaluate(`
        chunks.push(["later", registry]);
        [registry === originalRegistry, chunks === originalChunks,
          registry.main === originalFactory, factory === originalFactory,
          chunks[0][1] === registry, chunks[1][1] === registry,
          globalThis.chunks === chunks, chunks.length]
      `)
      ).toMatchObject({ ok: true, returnValue: [true, true, true, true, true, true, true, 2] });
      expect(registered).toHaveBeenCalledTimes(1);
      expect(executed).not.toHaveBeenCalled();
      expect(await realm.evaluate("registry.main() === originalChunks")).toMatchObject({
        ok: true,
        returnValue: true
      });
      expect(executed).toHaveBeenCalledTimes(1);
      expect(registered).toHaveBeenCalledTimes(1);
    } finally {
      await realm.close();
    }
  });

  it.each([false, true])(
    "keeps injected host bindings immutable and callable (strict: %s)",
    async (strict) => {
      const hostCall = vi.fn((value: number) => value + 10);
      const realm = createRealm({ classicScripts: true, bindings: { hostCall, hostValue: 7 } });
      try {
        expect(
          await realm.evaluate(`
        ${strict ? '"use strict";' : ""}
        const originalHostCall = hostCall;
        const errors = [];
        try { hostCall = () => -1; } catch (error) { errors.push(error.name); }
        try { hostValue = 0; } catch (error) { errors.push(error.name); }
        [hostCall === originalHostCall, hostValue, hostCall(4), errors]
      `)
        ).toMatchObject({ ok: true, returnValue: [true, 7, 14, ["TypeError", "TypeError"]] });
        expect(
          await realm.evaluate("[hostCall === originalHostCall, hostValue, hostCall(5)]")
        ).toMatchObject({ ok: true, returnValue: [true, 7, 15] });
        expect(hostCall).toHaveBeenCalledTimes(2);
        expect(hostCall).toHaveBeenNthCalledWith(1, 4);
        expect(hostCall).toHaveBeenNthCalledWith(2, 5);
      } finally {
        await realm.close();
      }
    }
  );

  it.each([
    "return 1;",
    "await 1;",
    "import { value } from 'cap';",
    "import 'cap';",
    "export const value = 1;",
    "export default 1;",
    "import.meta;",
    "new.target;"
  ])("rejects non-Script grammar before executing host effects: %s", async (source) => {
    const effect = vi.fn();
    const realm = createRealm({
      classicScripts: true,
      bindings: { effect },
      modules: { cap: { value: 1 } }
    });
    try {
      await expect(realm.evaluate(`effect(); ${source}`)).rejects.toMatchObject({
        name: "SyntaxError"
      });
      expect(effect).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it.each([
    { source: "with ({ value: 3 }) { value; }", expected: 3 },
    { source: "var legacy = 010; legacy", expected: 8 },
    { source: "function duplicate(value, value) { return value; } duplicate(1, 2)", expected: 2 },
    { source: "var await = 3; await", expected: 3 },
    { source: "<!-- legacy comment\n7", expected: 7 },
    { source: "{ function blockFactory() { return 9; } } blockFactory()", expected: 9 }
  ])("preserves appropriate sloppy Script grammar: $source", async ({ source, expected }) => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(await realm.evaluate(source)).toMatchObject({ ok: true, returnValue: expected });
    } finally {
      await realm.close();
    }
  });

  it.each([
    "with ({ value: 3 }) { value; }",
    "var legacy = 010;",
    "function duplicate(value, value) {}"
  ])("enforces a Script's strict directive before execution: %s", async (source) => {
    const effect = vi.fn();
    const realm = createRealm({ classicScripts: true, bindings: { effect } });
    try {
      await expect(realm.evaluate(`"use strict"; effect(); ${source}`)).rejects.toMatchObject({
        name: "SyntaxError"
      });
      expect(effect).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("keeps function strictness without making later Scripts strict", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(
        await realm.evaluate(`
        "use strict";
        function strictReceiver() { return this; }
        this === globalThis
      `)
      ).toMatchObject({ ok: true, returnValue: true });
      expect(
        await realm.evaluate(`
        implicitValue = 7;
        function sloppyReceiver() { return this; }
        [strictReceiver() === undefined, sloppyReceiver() === globalThis,
          globalThis.implicitValue, this === globalThis]
      `)
      ).toMatchObject({ ok: true, returnValue: [true, true, 7, true] });
    } finally {
      await realm.close();
    }
  });

  it("returns Script completion values rather than requiring a top-level return", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(await realm.evaluate("7; var first = 1;")).toMatchObject({ ok: true, returnValue: 7 });
      expect(await realm.evaluate("1; { 2; var second = 3; }")).toMatchObject({
        ok: true,
        returnValue: 2
      });
      expect(await realm.evaluate("var third = 4;")).toMatchObject({
        ok: true,
        returnValue: undefined
      });
    } finally {
      await realm.close();
    }
  });

  it("keeps explicit modules strict and lexical while allowing them to read Script globals", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(
        await realm.evaluate(`
        var scriptValue = 3;
        let scriptLexical = 4;
        const scriptConstant = 5;
        let shadowed = "script";
        function readScript() { return scriptValue + scriptLexical + scriptConstant; }
      `)
      ).toMatchObject({ ok: true });
      expect(
        await realm.evaluate(
          `
        var moduleVariable = 1;
        let moduleLexical = 2;
        const moduleConstant = 3;
        let shadowed = "module";
        function moduleReceiver() { return this; }
        export const topIsUndefined = this === undefined;
        export const callIsUndefined = moduleReceiver() === undefined;
        export const seen = await Promise.resolve([scriptValue, scriptLexical, scriptConstant, readScript()]);
        export const local = [moduleVariable, moduleLexical, moduleConstant, shadowed];
        export const own = [Object.hasOwn(globalThis, "moduleVariable"),
          Object.hasOwn(globalThis, "moduleLexical"), Object.hasOwn(globalThis, "moduleConstant")];
      `,
          { filename: "classic-module-entry", sourceType: "module" }
        )
      ).toMatchObject({
        ok: true,
        returnValue: {
          topIsUndefined: true,
          callIsUndefined: true,
          seen: [3, 4, 5, 12],
          local: [1, 2, 3, "module"],
          own: [false, false, false]
        }
      });
      expect(
        await realm.evaluate(`
        [typeof moduleVariable, typeof moduleLexical, typeof moduleConstant,
          typeof moduleReceiver, typeof topIsUndefined, shadowed, readScript(), this === globalThis]
      `)
      ).toMatchObject({
        ok: true,
        returnValue: [
          "undefined",
          "undefined",
          "undefined",
          "undefined",
          "undefined",
          "script",
          12,
          true
        ]
      });
    } finally {
      await realm.close();
    }
  });

  it("uses module grammar for resolved dependencies that read persistent Script bindings", async () => {
    const realm = createRealm({
      classicScripts: true,
      sourceResolver: (specifier: string) =>
        specifier === "dep"
          ? {
              id: "classic-dependency",
              source:
                "export const topIsUndefined = this === undefined; export function read() { return [scriptValue, scriptLexical]; }"
            }
          : undefined
    });
    try {
      expect(await realm.evaluate("var scriptValue = 2; let scriptLexical = 3;")).toMatchObject({
        ok: true
      });
      expect(
        await realm.evaluate(
          `
        import { topIsUndefined, read } from "dep";
        export const receiver = topIsUndefined;
        export const seen = read();
      `,
          { filename: "classic-import-one", sourceType: "module" }
        )
      ).toMatchObject({ ok: true, returnValue: { receiver: true, seen: [2, 3] } });
      expect(await realm.evaluate("scriptValue = 5; scriptLexical = 6;")).toMatchObject({
        ok: true
      });
      expect(
        await realm.evaluate(
          `
        import { read } from "dep";
        export const seen = read();
      `,
          { filename: "classic-import-two", sourceType: "module" }
        )
      ).toMatchObject({ ok: true, returnValue: { seen: [5, 6] } });
    } finally {
      await realm.close();
    }
  });

  it("isolates global properties and lexical bindings between realms", async () => {
    const first = createRealm({ classicScripts: true });
    const second = createRealm({ classicScripts: true });
    try {
      expect(
        await first.evaluate(
          "var sharedName = 1; let lexicalName = 2; globalThis.marker = 'first';"
        )
      ).toMatchObject({ ok: true });
      expect(
        await second.evaluate(`
        [typeof sharedName, typeof lexicalName, Object.hasOwn(globalThis, "marker")]
      `)
      ).toMatchObject({ ok: true, returnValue: ["undefined", "undefined", false] });
      expect(
        await second.evaluate(
          "var sharedName = 8; let lexicalName = 9; globalThis.marker = 'second';"
        )
      ).toMatchObject({ ok: true });
      expect(await first.evaluate("[sharedName, lexicalName, globalThis.marker]")).toMatchObject({
        ok: true,
        returnValue: [1, 2, "first"]
      });
      await first.close();
      expect(await second.evaluate("[sharedName, lexicalName, globalThis.marker]")).toMatchObject({
        ok: true,
        returnValue: [8, 9, "second"]
      });
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("uses the same Script receiver and persistent environment for authorized nested source", async () => {
    const extension = defineExtension({
      manifest: {
        version: 1,
        name: "classic-nested",
        capabilities: ["source:nested"],
        globals: ["write"]
      },
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
    const realm = createRealm({
      classicScripts: true,
      extensions: [extension],
      grants: ["source:nested"]
    });
    try {
      expect(
        await realm.evaluate(`
        let retained = 1;
        const registry = {};
        write('"use strict"; retained += 1; var nestedReceiver = this === globalThis; const nestedAlias = registry; function nestedFactory() { return registry; }');
        [retained, nestedReceiver, nestedAlias === registry, nestedFactory() === registry]
      `)
      ).toMatchObject({ ok: true, returnValue: [2, true, true, true] });
      expect(
        await realm.evaluate(`
        [retained, globalThis.nestedReceiver, nestedAlias === registry,
          globalThis.nestedFactory === nestedFactory, Object.hasOwn(globalThis, "nestedAlias"),
          Object.getOwnPropertyDescriptor(globalThis, "nestedFactory").configurable]
      `)
      ).toMatchObject({ ok: true, returnValue: [2, true, true, true, false, false] });
    } finally {
      await realm.close();
    }
  });

  it.each(["return 1;", "await 1;", "import 'cap';", "export const value = 1;"])(
    "rejects non-Script grammar in authorized nested source: %s",
    async (source) => {
      const effect = vi.fn();
      const extension = defineExtension({
        manifest: {
          version: 1,
          name: "classic-nested-grammar",
          capabilities: ["source:nested"],
          globals: ["write"]
        },
        setup(context) {
          return {
            globals: {
              write: context.nestedOperation(async () => {
                await context.evaluateNested(`effect(); ${source}`);
              })
            }
          };
        }
      });
      const realm = createRealm({
        classicScripts: true,
        extensions: [extension],
        grants: ["source:nested"],
        bindings: { effect },
        modules: { cap: { value: 1 } }
      });
      try {
        await expect(realm.evaluate("write();")).rejects.toMatchObject({ name: "SyntaxError" });
        expect(effect).not.toHaveBeenCalled();
      } finally {
        await realm.close();
      }
    }
  );
});

describe("classicScripts option compatibility", () => {
  it.each([
    { origin: "caller", name: "this" },
    { origin: "caller", name: "globalThis" },
    { origin: "extension", name: "this" },
    { origin: "extension", name: "globalThis" }
  ])(
    "rejects a $origin binding named $name before executing a Script",
    async ({ origin, name }) => {
      const effect = vi.fn();
      const injected = { [name]: 7 };
      const extensions =
        origin === "extension"
          ? [
              defineExtension({
                manifest: { version: 1, name: "classic-receiver-binding", globals: [name] },
                setup() {
                  return { globals: injected };
                }
              })
            ]
          : [];
      let realm: SafeJSRealm | undefined;
      try {
        await expect(
          (async () => {
            realm = createRealm({
              classicScripts: true,
              bindings: origin === "caller" ? { ...injected, effect } : { effect },
              extensions
            });
            await realm.evaluate("effect();");
          })()
        ).rejects.toBeInstanceOf(TypeError);
        expect(effect).not.toHaveBeenCalled();
      } finally {
        await realm?.close();
      }
    }
  );

  it.each([
    { label: "omitted", options: {} },
    { label: "undefined", options: { classicScripts: undefined } },
    { label: "false", options: { classicScripts: false } }
  ] satisfies Array<{ label: string; options: RealmOptions }>)(
    "preserves executable-source imports, await, return and lexical storage when $label",
    async ({ options }) => {
      const realm = createRealm({ ...options, modules: { cap: { value: 7 } } });
      try {
        expect(
          await realm.evaluate(`
          import { value } from "cap";
          var legacyVariable = await Promise.resolve(value);
          let legacyLexical = 1;
          function legacyRead() { return legacyVariable + legacyLexical; }
          return [legacyRead(), Object.hasOwn(globalThis, "legacyVariable"),
            Object.hasOwn(globalThis, "legacyRead"), Object.hasOwn(globalThis, "legacyLexical")];
        `)
        ).toMatchObject({ ok: true, returnValue: [8, false, false, false] });
        expect(await realm.evaluate("legacyLexical += 1; return legacyRead();")).toMatchObject({
          ok: true,
          returnValue: 9
        });
      } finally {
        await realm.close();
      }
    }
  );

  it.each([
    { label: "null", value: null },
    { label: "zero", value: 0 },
    { label: "one", value: 1 },
    { label: "true string", value: "true" },
    { label: "false string", value: "false" },
    { label: "object", value: {} },
    { label: "array", value: [] },
    { label: "function", value: () => true }
  ])(
    "rejects an invalid classicScripts value synchronously at construction: $label",
    async ({ value }) => {
      const setup = vi.fn(() => ({}));
      const extension = defineExtension({
        manifest: { version: 1, name: "invalid-classic-option" },
        setup
      });
      let unexpectedRealm: SafeJSRealm | undefined;
      try {
        expect(() => {
          unexpectedRealm = createRealm({
            classicScripts: value as never,
            extensions: [extension]
          });
        }).toThrow(TypeError);
        expect(setup).not.toHaveBeenCalled();
      } finally {
        await unexpectedRealm?.close();
      }
    }
  );
});

describe("classic Script lifecycle and budgets", () => {
  it.each([false, true])(
    "rejects evaluation after idempotent close (initialized: %s)",
    async (initialized) => {
      const effect = vi.fn();
      const realm = createRealm({ classicScripts: true, bindings: { effect } });
      try {
        if (initialized) {
          expect(await realm.evaluate("var retained = 1;")).toMatchObject({ ok: true });
        }
        await realm.close();
        await realm.close();
        await expect(realm.evaluate("effect();")).rejects.toThrow(/closed/i);
        expect(effect).not.toHaveBeenCalled();
      } finally {
        await realm.close();
      }
    }
  );

  it.each(["close", "abort"] as const)(
    "cancels a Script-created active callback on %s and cleans up once",
    async (action) => {
      let callback: unknown;
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const cleanup = vi.fn();
      const controller = new AbortController();
      const extension = defineExtension({
        manifest: { version: 1, name: "classic-pending", globals: ["save", "pending"] },
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
      });
      const realm = createRealm({
        classicScripts: true,
        signal: controller.signal,
        extensions: [extension]
      });
      try {
        expect(
          await realm.evaluate("save(async () => { await pending(); return 1; });")
        ).toMatchObject({ ok: true });
        const invocation = realm.invokeCallback(callback);
        void invocation.catch(() => undefined);
        await Promise.race([entered, invocation]);
        const rejected = expect(invocation).rejects.toThrow(
          action === "close" ? /closed|aborted/i : "stop classic callback"
        );
        if (action === "close") {
          await realm.close();
        } else {
          controller.abort(new Error("stop classic callback"));
        }
        await rejected;
        await realm.close();
        await realm.close();
        expect(cleanup).toHaveBeenCalledTimes(1);
        await expect(realm.evaluate("1;")).rejects.toThrow();
        await expect(realm.invokeCallback(callback)).rejects.toThrow();
      } finally {
        await realm.close();
      }
    }
  );

  it("honors a pre-aborted signal before executing a Script", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop classic before entry"));
    const effect = vi.fn();
    const realm = createRealm({
      classicScripts: true,
      signal: controller.signal,
      bindings: { effect }
    });
    try {
      await expect(realm.evaluate("effect();")).rejects.toThrow("stop classic before entry");
      expect(effect).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("keeps finite step exhaustion fatal even when a Script attempts to catch it", async () => {
    const effect = vi.fn();
    const realm = createRealm({
      classicScripts: true,
      bindings: { effect },
      budget: new Budget({ maxSteps: 2000 })
    });
    try {
      expect(await realm.evaluate("var retained = 0;")).toMatchObject({ ok: true });
      await expect(
        realm.evaluate(`
        try {
          for (var index = 0; index < 10000; index++) retained += 1;
        } catch {}
        effect();
      `)
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
      expect(effect).not.toHaveBeenCalled();
      await expect(realm.evaluate("1;")).rejects.toThrow();
    } finally {
      await realm.close();
    }
  });
});
