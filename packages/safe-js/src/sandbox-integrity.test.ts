import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";

import { createSink } from "../test/sinks.js";
import { runCli } from "./cli.js";
import { createLintModulesFromRuntimeRegistry } from "./lint/runtime-modules.js";
import { lint } from "./lint/index.js";
import { makeFsModule, type FsImplementation } from "./modules/fs.js";
import { makeTimeModule } from "./modules/time.js";
import { run } from "./run.js";

describe("sandbox integrity at the run boundary", () => {
  it.each([
    [
      "object dot __proto__",
      "const value = {}; value.__proto__ = { polluted: true }; return value;"
    ],
    [
      "object computed constructor",
      'const value = {}; const key = "constructor"; value[key] = { polluted: true }; return value;'
    ],
    [
      "object dot prototype",
      "const value = {}; value.prototype = { polluted: true }; return value;"
    ],
    [
      "object logical __proto__",
      "const value = {}; value.__proto__ ??= { polluted: true }; return value;"
    ],
    ["object compound constructor", 'const value = {}; value.constructor += "host"; return value;'],
    ["object update prototype", "const value = {}; value.prototype++; return value;"],
    [
      "object destructuring member target",
      "const value = {}; ({ next: value.__proto__ } = { next: { polluted: true } }); return value;"
    ],
    [
      "array dot __proto__",
      "const value = []; value.__proto__ = { polluted: true }; return value;"
    ],
    [
      "array computed constructor",
      'const value = []; const key = "constructor"; value[key] = { polluted: true }; return value;'
    ],
    [
      "array dot prototype",
      "const value = []; value.prototype = { polluted: true }; return value;"
    ],
    [
      "array destructuring member target",
      "const value = []; [value.__proto__] = [{ polluted: true }]; return value;"
    ],
    [
      "computed object literal __proto__",
      'const key = "__proto__"; return { [key]: { polluted: true } };'
    ],
    [
      "Object.fromEntries __proto__",
      'return Object.fromEntries([["__proto__", { polluted: true }]]);'
    ],
    [
      "Object.assign __proto__",
      'const value = {}; Object.assign(value, JSON.parse("{\\"__proto__\\":{\\"polluted\\":true}}")); return value;'
    ],
    [
      "Object.assign array __proto__",
      'const value = []; Object.assign(value, JSON.parse("{\\"__proto__\\":{\\"polluted\\":true}}")); return value;'
    ]
  ])("keeps %s writes from changing host prototypes", async (_label, source) => {
    const result = await run(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const value = result.returnValue as object;
    const expectedPrototype = Array.isArray(value) ? Array.prototype : null;
    expect(Object.getPrototypeOf(value)).toBe(expectedPrototype);
    expect((value as { polluted?: unknown }).polluted).toBeUndefined();

    const freshResult = await run(Array.isArray(value) ? "return [];" : "return {};");
    expect(freshResult.ok).toBe(true);
    if (!freshResult.ok) return;
    const fresh = freshResult.returnValue as object;
    expect(Object.getPrototypeOf(fresh)).toBe(expectedPrototype);
    expect((fresh as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("stores hostile Map keys and Set values without affecting host prototypes", async () => {
    const result = await run(`
      const map = new Map();
      map.set("__proto__", { polluted: true });
      map.set("constructor", { polluted: true });
      map.set("prototype", { polluted: true });
      const set = new Set();
      set.add("__proto__");
      set.add("constructor");
      set.add("prototype");
      return {
        mapKeys: [...map.keys()],
        mapValues: [...map.values()],
        setValues: [...set],
        freshObject: {},
        freshArray: []
      };
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const value = result.returnValue as {
      mapKeys: string[];
      mapValues: Array<{ polluted: boolean }>;
      setValues: string[];
      freshObject: object;
      freshArray: unknown[];
    };
    expect(value.mapKeys).toEqual(["__proto__", "constructor", "prototype"]);
    expect(value.mapValues).toEqual([{ polluted: true }, { polluted: true }, { polluted: true }]);
    expect(value.setValues).toEqual(["__proto__", "constructor", "prototype"]);
    expect(Object.getPrototypeOf(value.freshObject)).toBeNull();
    expect(Object.getPrototypeOf(value.freshArray)).toBe(Array.prototype);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(([] as unknown as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("keeps native prototype reads closed while exposing guest constructor identity", async () => {
    const result = await run(`
      const closure = function () {};
      return [
        ({}).__proto__, ({}).constructor === Object, ({}).prototype,
        [].__proto__, [].constructor, [].prototype,
        "value".__proto__, "value".constructor === String, "value".prototype,
        (1).__proto__, (1).constructor === Number, (1).prototype,
        closure.__proto__, closure.constructor, closure.prototype.constructor === closure,
        typeof ([1].toSorted)
      ];
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: [
        undefined, true, undefined,
        undefined, undefined, undefined,
        undefined, true, undefined,
        undefined, true, undefined,
        undefined, undefined, true, "function"
      ]
    });
  });

  it("treats non-computed object literal __proto__ as prototype syntax", async () => {
    const result = await run(`
      const key = "__proto__";
      let evaluated = false;
      const literal = { __proto__: (evaluated = true, null) };
      const computed = { [key]: "own" };
      const shorthandSource = "shorthand";
      const __proto__ = shorthandSource;
      const shorthand = { __proto__ };
      return [literal.__proto__, evaluated, computed.__proto__, shorthand.__proto__];
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: [undefined, true, "own", "shorthand"]
    });
  });

  it("allows supported closed-world methods and directs unsupported member calls", async () => {
    await expect(run("return [2, 1].toSorted();")).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2]
    });
    await expect(run("return [1].shuffle();")).rejects.toMatchObject({
      name: "TypeError",
      message: "Array#shuffle is not a supported method."
    });
  });

  it.each([
    ["closure constructor", "return (function () {}).constructor;"],
    ["object constructor", "return ({}).constructor.constructor;"],
    ["array constructor", "return [].constructor;"]
  ])("does not expose a Function constructor through %s", async (_label, source) => {
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: undefined });
  });

  it.each([
    [
      "closure gadget",
      'return (function () {}).constructor("return process")();',
      "Function#constructor is not a supported method."
    ],
    [
      "object gadget",
      'return ({}).constructor("return process")();',
      "Attempted to call a non-function value."
    ],
    [
      "array gadget",
      'return [].constructor("return process")();',
      "Array#constructor is not a supported method."
    ]
  ])("fails closed for the %s", async (_label, source, message) => {
    await expect(run(source)).rejects.toMatchObject({
      name: "TypeError",
      message
    });
  });

  it("does not propagate hostile JSON keys through spread, destructuring, or cloning", async () => {
    const result = await run(`
      const hostile = JSON.parse("{\\"__proto__\\":{\\"polluted\\":true},\\"constructor\\":7,\\"prototype\\":8,\\"safe\\":9}");
      const spread = { ...hostile };
      const { safe, ...rest } = hostile;
      const clone = structuredClone(hostile);
      return { hostile, spread, rest, clone, safe, freshObject: {}, freshArray: [] };
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const value = result.returnValue as Record<string, Record<string, unknown> | unknown>;
    for (const key of ["hostile", "spread", "rest", "clone"] as const) {
      const object = value[key] as Record<string, unknown>;
      expect(Object.getPrototypeOf(object)).toBeNull();
      expect(object.polluted).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(object, "__proto__")).toMatchObject({
        enumerable: true,
        value: { polluted: true }
      });
    }
    expect(value.safe).toBe(9);
    expect(Object.getPrototypeOf(value.freshObject)).toBeNull();
    expect(Object.getPrototypeOf(value.freshArray)).toBe(Array.prototype);
  });

  it("rejects host objects with a custom prototype before sandbox evaluation", async () => {
    const hostile = Object.create({ polluted: true }) as Record<string, unknown>;
    hostile.safe = 1;

    await expect(run("return input;", { bindings: { input: hostile } })).rejects.toThrow(
      "Unsupported sandbox value at <root>: Object"
    );
  });

  it("rejects host accessor properties before sandbox evaluation", async () => {
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "secret", {
      enumerable: true,
      get: () => "host secret"
    });

    await expect(run("return input;", { bindings: { input: hostile } })).rejects.toThrow(
      "Unsupported sandbox value at <root>.secret: accessor property"
    );
  });
});

// A sandbox has no filesystem until an embedder registers one, so `fs` is only ever as reachable
// as any other unregistered module: nothing names it, and nothing has to. These drive the one
// source both ways around that single registration to keep the unregistered answer a property of
// the empty registry rather than of a rule that knows the word "fs".
describe("filesystem access at the sandbox boundary", () => {
  function readFileSource(moduleName: string): string {
    return `import { readFile } from "${moduleName}";\nreturn await readFile("/repo/file.txt", "utf8");`;
  }

  function createMemoryFs(): FsImplementation {
    const volume = Volume.fromJSON({ "/repo/file.txt": "contents" }, "/");
    return createFsFromVolume(volume).promises as unknown as FsImplementation;
  }

  it("leaves a default run() without an 'fs' module", async () => {
    await expect(run(readFileSource("fs"))).rejects.toThrow(
      "Unknown module 'fs'. No modules are registered."
    );
  });

  it("names the registered modules and not 'fs' when a registry omits it", async () => {
    await expect(run(readFileSource("fs"), { modules: { time: makeTimeModule() } })).rejects.toThrow(
      "Unknown module 'fs'. Available modules: time."
    );
  });

  it("reports 'fs' from the runtime registry through the generic unknown-module rule", () => {
    expect(
      lint(readFileSource("fs"), {
        modules: createLintModulesFromRuntimeRegistry({ time: makeTimeModule() })
      })
    ).toMatchObject([
      {
        code: "AS004",
        severity: "error",
        message: "Unknown module 'fs'. Available modules: time."
      }
    ]);
  });

  // The CLI's own registry is the default an embedder gets without asking for one, and it feeds
  // both the lint pass and the run, so a script naming fs is refused before it ever evaluates.
  it("leaves the default poe-safejs registry without an 'fs' module", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["script.ajs"], {
      cwd: "/repo",
      readFile: async () => readFileSource("fs"),
      stat: async () => ({ isFile: () => true }),
      stderr,
      stdout
    });

    expect(exitCode).toBe(1);
    expect(stderr.output()).toContain(
      "Unknown module 'fs'. Available modules: agent, fail, log, metric."
    );
    expect(stdout.output()).toBe("");
  });

  // 'node:fs' never reaches a registry lookup at all: only bare specifiers parse, so the prefix is
  // refused a layer earlier than the unknown-module diagnostic. lint() surfaces that as the parse
  // error thrown rather than a diagnostic, since no rule parses specifiers itself.
  it("refuses a 'node:fs' specifier before any registry lookup", async () => {
    await expect(run(readFileSource("node:fs"))).rejects.toThrow(
      "Invalid import specifier 'node:fs' at line 1, column 26."
    );
    expect(() =>
      lint(readFileSource("node:fs"), {
        modules: createLintModulesFromRuntimeRegistry({ time: makeTimeModule() })
      })
    ).toThrow("Invalid import specifier 'node:fs' at line 1, column 26.");
  });

  it("refuses a 'node:fs' specifier through the default poe-safejs registry", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["script.ajs"], {
      cwd: "/repo",
      readFile: async () => readFileSource("node:fs"),
      stat: async () => ({ isFile: () => true }),
      stderr,
      stdout
    });

    expect(exitCode).toBe(2);
    expect(stderr.output()).toContain("Invalid import specifier 'node:fs' at line 1, column 26.");
    expect(stdout.output()).toBe("");
  });

  // The prefix is not a way around the registry either: registering fs under 'node:fs' still
  // leaves the specifier unparseable, so the mirror case below has to use the bare name.
  it("keeps a 'node:fs' specifier refused even when an embedder registers that name", async () => {
    const modules = { "node:fs": makeFsModule({ fs: createMemoryFs() }) };

    await expect(run(readFileSource("node:fs"), { modules })).rejects.toThrow(
      "Invalid import specifier 'node:fs' at line 1, column 26."
    );
  });

  it("lints and runs the same 'fs' import once makeFsModule is registered", async () => {
    const modules = { fs: makeFsModule({ fs: createMemoryFs() }) };

    expect(
      lint(readFileSource("fs"), { modules: createLintModulesFromRuntimeRegistry(modules) })
    ).toEqual([]);
    await expect(run(readFileSource("fs"), { modules })).resolves.toMatchObject({
      ok: true,
      returnValue: "contents"
    });
  });
});
