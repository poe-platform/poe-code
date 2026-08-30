import { describe, expect, it, vi } from "vitest";

import { Budget } from "../interp/budget.js";
import { getFunctionMember } from "../interp/methods/function.js";
import {
  createSandboxClosure,
  isSandboxClosure,
  createSandboxArguments,
  isSandboxArguments,
  createSandboxGenerator,
  isSandboxGenerator,
  createSandboxMap,
  createSandboxSet,
  isSandboxMap,
  isSandboxPromise,
  isSandboxSet
} from "../interp/values.js";
import { createGeneratorChannel } from "../interp/generator.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule, type Module, type ParseResult } from "../parse/parser.js";
import { hashSource } from "../parse/hash.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";
import { createSandboxRegex, isSandboxRegex } from "../interp/values.js";
import { SnapshotValidationError } from "./validation.js";
import { MAX_DATA_DEPTH } from "../graph-depth.js";

function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => T
): T {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("snapshot restore", () => {
  it.each([
    "extensibility",
    "length order",
    "callee replacement",
    "missing value",
    "iterator flags",
    "accessor"
  ])("rejects corrupt arguments metadata: %s", (corruption) => {
    const source = "await task()";
    const args = createSandboxArguments([5]);
    const snapshot = serialize({
      source,
      currentAstNodeId: getNodeIdByType(parseModule(source), "AwaitExpression"),
      scopeChain: [{ id: "module", bindings: { args } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    const entry = Object.values(snapshot.heap ?? {})[0];
    if (entry?.kind !== "arguments") throw new Error("Missing arguments snapshot");
    if (corruption === "extensibility") Reflect.set(entry, "extensible", "yes");
    if (corruption === "length order") delete entry.properties.length;
    if (corruption === "callee replacement") entry.properties.callee = entry.properties["0"];
    if (corruption === "missing value") Reflect.deleteProperty(entry.properties["0"], "value");
    if (corruption === "iterator flags") Reflect.set(entry.iterator!, "writable", "yes");
    if (corruption === "accessor") Reflect.set(entry.properties["0"], "get", null);
    expect(() => restore(snapshot, { source })).toThrow(SnapshotValidationError);
  });

  it.each(["deleted length", "readded length", "frozen", "hidden property"])(
    "roundtrips arguments with %s",
    (mode) => {
      const source = "await task()";
      const args = createSandboxArguments([5, 6]);
      if (mode === "deleted length") delete args.length;
      if (mode === "readded length") {
        delete args.length;
        args.extra = 7;
        args.length = 2;
      }
      if (mode === "frozen") Object.freeze(args);
      if (mode === "hidden property") Object.defineProperty(args, "hidden", { value: 9 });
      const snapshot = serialize({
        source,
        currentAstNodeId: getNodeIdByType(parseModule(source), "AwaitExpression"),
        scopeChain: [{ id: "module", bindings: { args } }],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      });
      const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source }).currentScope.lookup(
        "args"
      );
      expect(binding.found).toBe(true);
      if (!binding.found) return;
      expect(Object.getOwnPropertyNames(binding.value)).toEqual(Object.getOwnPropertyNames(args));
      for (const key of Reflect.ownKeys(args)) {
        expect(Object.getOwnPropertyDescriptor(binding.value, key)).toEqual(
          Object.getOwnPropertyDescriptor(args, key)
        );
      }
      expect(Object.isExtensible(binding.value)).toBe(Object.isExtensible(args));
    }
  );

  it("bounds deeply nested data retained through arguments length", () => {
    const args = createSandboxArguments([]);
    let value = {};
    for (let depth = 0; depth < MAX_DATA_DEPTH + 1; depth += 1) value = { next: value };
    args.length = value;
    expect(() =>
      serialize({
        source: "await task()",
        currentAstNodeId: 1,
        scopeChain: [{ id: "module", bindings: { args } }],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      })
    ).toThrowError(expect.objectContaining({ name: "SnapshotBudgetError", budget: "dataDepth" }));
  });

  it("roundtrips arguments identity, properties, iteration, and strict callee access", () => {
    const source = "await task()";
    const currentAstNodeId = getNodeIdByType(parseModule(source), "AwaitExpression");
    const args = createSandboxArguments([5, 6]);
    args.length = 1;
    args.self = args;
    const snapshot = serialize({
      source,
      currentAstNodeId,
      scopeChain: [{ id: "module", bindings: { args, alias: args } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
    const binding = restored.currentScope.lookup("args");
    expect(binding.found).toBe(true);
    if (!binding.found) return;
    expect(isSandboxArguments(binding.value)).toBe(true);
    expect(binding.value).toMatchObject({ length: 1, 0: 5, 1: 6 });
    expect(Object.keys(binding.value)).toEqual(["0", "1", "self"]);
    expect(Array.from(binding.value as Iterable<unknown>)).toEqual([5]);
    expect(() => binding.value.callee).toThrow(TypeError);
    expect(binding.value.self).toBe(binding.value);
    expect(restored.currentScope.lookup("alias")).toMatchObject({ value: binding.value });
  });

  it("restores thousands of parent scopes without using the host call stack", () => {
    const source = "await task()";
    const module = parseModule(source);
    const currentAstNodeId = getNodeIdByType(module, "AwaitExpression");
    const scopeChain = Array.from({ length: 5_000 }, (_, index) => ({
      id: index,
      ...(index === 0 ? {} : { parentId: index - 1 }),
      bindings: { [`value${index}`]: index }
    }));

    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId,
        scopeChain: scopeChain.reverse(),
        callStack: [{ astNodeId: currentAstNodeId, scopeId: 4_999 }],
        pendingPromises: [],
        moduleBindings: {}
      },
      { source, budget: new Budget({ maxCallDepth: 5_000 }) }
    );

    expect(restored.currentScope.lookup("value0")).toMatchObject({ found: true, value: 0 });
    expect(restored.currentScope.lookup("value4999")).toMatchObject({ found: true, value: 4_999 });
  });
  it.each([
    ["missing source hash", (snapshot: any) => delete snapshot.sourceHash, "$.sourceHash"],
    ["missing scope id", (snapshot: any) => delete snapshot.scopeChain[0].id, "$.scopeChain[0].id"],
    [
      "duplicate scope id",
      (snapshot: any) => snapshot.scopeChain.push({ id: "module", bindings: {} }),
      "$.scopeChain[1].id"
    ],
    [
      "dangling parent",
      (snapshot: any) => (snapshot.scopeChain[0].parentId = "missing"),
      "$.scopeChain[0].parentId"
    ],
    [
      "cyclic parents",
      (snapshot: any) => {
        snapshot.scopeChain.push({ id: "child", parentId: "module", bindings: {} });
        snapshot.scopeChain[0].parentId = "child";
      },
      "$.scopeChain"
    ],
    [
      "dangling capture",
      (snapshot: any) =>
        (snapshot.scopeChain[0].bindings.fn = {
          kind: "fn",
          astNodeId: snapshot.currentAstNodeId,
          capturedScopeId: "missing"
        }),
      "$.scopeChain[0].bindings.fn.capturedScopeId"
    ],
    [
      "dangling node",
      (snapshot: any) => (snapshot.currentAstNodeId = 999999),
      "$.currentAstNodeId"
    ],
    [
      "unsafe id",
      (snapshot: any) => (snapshot.scopeChain[0].id = Number.MAX_SAFE_INTEGER + 1),
      "$.scopeChain[0].id"
    ],
    [
      "invalid promise",
      (snapshot: any) => snapshot.pendingPromises.push({ id: "p", status: "pending", value: 1 }),
      "$.pendingPromises[0]"
    ],
    [
      "fulfilled promise without value",
      (snapshot: any) => snapshot.pendingPromises.push({ id: "p", status: "fulfilled" }),
      "$.pendingPromises[0].value"
    ],
    [
      "rejected promise with value",
      (snapshot: any) =>
        snapshot.pendingPromises.push({ id: "p", status: "rejected", reason: "bad", value: 1 }),
      "$.pendingPromises[0]"
    ],
    [
      "mismatched host call tag",
      (snapshot: any) =>
        snapshot.pendingPromises.push({
          id: "git-commit-1",
          moduleId: "git",
          operation: "commit",
          sideEffectTag: {
            kind: "host-call-side-effect",
            callId: "different",
            moduleId: "git",
            operation: "commit"
          }
        }),
      "$.pendingPromises[0].sideEffectTag.callId"
    ],
    [
      "invalid generator",
      (snapshot: any) =>
        (snapshot.scopeChain[0].bindings.gen = {
          kind: "generator",
          state: "done",
          yieldNodeId: 1
        }),
      "$.scopeChain[0].bindings.gen"
    ],
    [
      "invalid generator completion",
      (snapshot: any) =>
        (snapshot.scopeChain[0].bindings.gen = {
          kind: "generator",
          state: "suspended",
          astNodeId: snapshot.currentAstNodeId,
          capturedScopeId: "module",
          yieldNodeId: snapshot.currentAstNodeId,
          sent: [{ type: "future", value: 1 }]
        }),
      "$.scopeChain[0].bindings.gen.sent[0].type"
    ],
    [
      "malformed map entry",
      (snapshot: any) => {
        snapshot.heap = { "1": { kind: "map", entries: [[1]] } };
        snapshot.scopeChain[0].bindings.map = { kind: "ref", id: 1 };
      },
      '$.heap["1"].entries[0]'
    ],
    [
      "negative regex cursor",
      (snapshot: any) =>
        (snapshot.scopeChain[0].bindings.regex = {
          kind: "regex",
          source: "a",
          flags: "g",
          lastIndex: -1
        }),
      "$.scopeChain[0].bindings.regex.lastIndex"
    ],
    [
      "non-finite number payload",
      (snapshot: any) =>
        (snapshot.scopeChain[0].bindings.number = { kind: "number", value: "future" }),
      "$.scopeChain[0].bindings.number.value"
    ]
  ])("rejects mutated snapshots: %s", (_name, mutate, path) => {
    const source = "await task()";
    const module = parseModule(source);
    const snapshot: any = {
      sourceHash: hashSource(source),
      currentAstNodeId: getNodeIdByType(module, "AwaitExpression"),
      scopeChain: [{ id: "module", bindings: {} }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    };
    mutate(snapshot);
    expect(() => restore(snapshot, { source, budget: new Budget() })).toThrowError(
      expect.objectContaining({ name: "SnapshotValidationError", path })
    );
  });

  it("rejects excessive nesting and accepts the configured maximum collection size", () => {
    const source = "await task()";
    const base: any = {
      sourceHash: hashSource(source),
      currentAstNodeId: getNodeIdByType(parseModule(source), "AwaitExpression"),
      scopeChain: [{ id: "module", bindings: {} }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    };
    let deep: any = 1;
    for (let index = 0; index < MAX_DATA_DEPTH + 2; index += 1) deep = { value: deep };
    base.scopeChain[0].bindings.deep = deep;
    expect(() => restore(base, { source, budget: new Budget() })).toThrow(SnapshotValidationError);

    base.scopeChain[0].bindings = { items: [1, 2, 3] };
    expect(() => restore(base, { source, budget: new Budget({ arrayLength: 3 }) })).not.toThrow();
  });

  it("preserves prototype-shaped keys and validates before wrapping host modules", () => {
    const source = "await task()";
    const wrapped = vi.fn();
    const bindings = Object.create(null);
    bindings.__proto__ = 1;
    const snapshot: any = {
      sourceHash: hashSource(source),
      currentAstNodeId: 999999,
      scopeChain: [{ id: "module", bindings }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: { host: "host" }
    };
    expect(() => restore(snapshot, { source, modules: { host: { wrapped } } })).toThrow(
      SnapshotValidationError
    );
    expect(wrapped).not.toHaveBeenCalled();
  });
  it("round-trips start and done generators", async () => {
    const source = "function* values() { yield 1; return 2; } await task();";
    const module = parseModule(source);
    const generatorNodeId = getNodeIdByType(module, "FunctionDeclaration");
    const startGenerator = createSandboxGenerator(
      createGeneratorChannel(async () => undefined),
      {
        astNodeId: generatorNodeId,
        capturedScopeId: "module"
      }
    );
    const doneGenerator = createSandboxGenerator(createGeneratorChannel(async () => undefined));
    doneGenerator.state = "done";
    const serialized = serialize({
      source,
      currentAstNodeId: getNodeIdByType(module, "AwaitExpression"),
      scopeChain: [
        {
          id: "module",
          bindings: {
            start: startGenerator,
            done: doneGenerator
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    const snapshot = restore(serialized, { source, budget: new Budget() });
    const start = snapshot.currentScope.lookup("start");
    const done = snapshot.currentScope.lookup("done");

    expect(start.found && isSandboxGenerator(start.value)).toBe(true);
    expect(done.found && isSandboxGenerator(done.value)).toBe(true);
    if (
      !start.found ||
      !isSandboxGenerator(start.value) ||
      !done.found ||
      !isSandboxGenerator(done.value)
    ) {
      return;
    }

    await expect(start.value.channel.next()).resolves.toEqual({ value: 1, done: false });
    await expect(start.value.channel.next()).resolves.toEqual({ value: 2, done: true });
    await expect(done.value.channel.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("round-trips a generator suspended at its first yield", async () => {
    const source = "function* values() { yield 1; yield 2; return 3; } await task();";
    const module = parseModule(source);
    const generatorNodeId = getNodeIdByType(module, "FunctionDeclaration");
    const yieldNodeId = getNodeIdsByType(module, "YieldExpression")[0]!;
    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId: getNodeIdByType(module, "AwaitExpression"),
        scopeChain: [
          { id: "module", bindings: {} },
          {
            id: "generator",
            parentId: "module",
            bindings: {
              generator: {
                kind: "generator",
                state: "suspended",
                astNodeId: generatorNodeId,
                capturedScopeId: "generator",
                yieldNodeId,
                sent: [{ type: "normal", value: { kind: "undefined" } }]
              }
            }
          }
        ],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      },
      { source, budget: new Budget() }
    );
    const binding = restored.currentScope.lookup("generator");
    expect(binding.found && isSandboxGenerator(binding.value)).toBe(true);
    if (!binding.found || !isSandboxGenerator(binding.value)) {
      return;
    }
    const generator = binding.value;

    await expect(generator.channel.next()).resolves.toEqual({ value: 2, done: false });
    await expect(generator.channel.next()).resolves.toEqual({ value: 3, done: true });
  });

  it("round-trips after sent values update captured scope", async () => {
    const source =
      "function* values() { const state = { value: yield 1 }; state.value = yield state.value; return state.value; } await task();";
    const module = parseModule(source);
    const generator = restoreSuspendedGenerator(source, module, {
      bindings: { state: { value: 7 } },
      sent: [
        { type: "normal", value: { kind: "undefined" } },
        { type: "normal", value: 7 }
      ],
      yieldNodeId: getNodeIdsByType(module, "YieldExpression")[1]!
    });

    await expect(generator.channel.next(9)).resolves.toEqual({ value: 9, done: true });
  });

  it("round-trips yield star delegation", async () => {
    const source = "function* values() { return yield* [1, 2, 3]; } await task();";
    const module = parseModule(source);
    const generator = restoreSuspendedGenerator(source, module, {
      bindings: {},
      sent: [
        { type: "normal", value: { kind: "undefined" } },
        { type: "normal", value: "first" }
      ],
      yieldNodeId: getNodeIdByType(module, "YieldExpression")
    });

    await expect(generator.channel.next("second")).resolves.toEqual({ value: 3, done: false });
    await expect(generator.channel.next("third")).resolves.toEqual({
      value: undefined,
      done: true
    });
  });

  it("runs a restored generator's finally when for of breaks early", async () => {
    const source =
      "function* values() { try { yield 1; yield 2; } finally { log.push('closed'); } } await task();";
    const module = parseModule(source);
    const restored = restoreSuspendedGeneratorState(source, module, {
      bindings: { log: [] },
      sent: [{ type: "normal", value: { kind: "undefined" } }],
      yieldNodeId: getNodeIdsByType(module, "YieldExpression")[0]!
    });
    const log = restored.currentScope.lookup("log");
    const result = await interpret(
      program("for (const value of generator) { break; } return log;"),
      { bindings: { generator: restored.generator, log: log.found ? log.value : undefined } }
    );

    expect(result).toMatchObject({ ok: true, returnValue: ["closed"] });
  });

  it("runs a restored generator's finally before propagating throw", async () => {
    const source =
      "function* values() { try { yield 1; yield 2; } finally { log.push('closed'); } } await task();";
    const module = parseModule(source);
    const restored = restoreSuspendedGeneratorState(source, module, {
      bindings: { log: [] },
      sent: [{ type: "normal", value: { kind: "undefined" } }],
      yieldNodeId: getNodeIdsByType(module, "YieldExpression")[0]!
    });
    const log = restored.currentScope.lookup("log");
    const error = new Error("stop");

    await expect(restored.generator.channel.throw(error)).rejects.toBe(error);
    expect(log.found ? log.value : undefined).toEqual(["closed"]);
  });

  it("round-trips collection shared keys and cycles", () => {
    const source = "await task()";
    const shared = { id: "shared" };
    const map = createSandboxMap();
    const set = createSandboxSet([shared]);
    map.entries.set(shared, set);
    map.entries.set("self", map);
    const secondMap = createSandboxMap([[shared, "again"]]);

    const snapshot = serialize({
      source,
      currentAstNodeId: 1,
      scopeChain: [{ id: "module", bindings: { map, secondMap } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    expect(Object.values(snapshot.heap ?? {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "map", entries: expect.any(Array) }),
        expect.objectContaining({ kind: "set", values: expect.any(Array) })
      ])
    );
    const restored = restore(snapshot, { source, budget: new Budget() });
    const mapBinding = restored.currentScope.lookup("map");
    const secondMapBinding = restored.currentScope.lookup("secondMap");
    expect(mapBinding.found && isSandboxMap(mapBinding.value)).toBe(true);
    expect(secondMapBinding.found && isSandboxMap(secondMapBinding.value)).toBe(true);
    if (
      !mapBinding.found ||
      !isSandboxMap(mapBinding.value) ||
      !secondMapBinding.found ||
      !isSandboxMap(secondMapBinding.value)
    ) {
      return;
    }

    const [[restoredShared, restoredSet]] = [...mapBinding.value.entries];
    expect(isSandboxSet(restoredSet)).toBe(true);
    expect(mapBinding.value.entries.get("self")).toBe(mapBinding.value);
    expect([...secondMapBinding.value.entries.keys()][0]).toBe(restoredShared);
    if (isSandboxSet(restoredSet)) {
      expect([...restoredSet.values][0]).toBe(restoredShared);
    }
  });

  it("round-trips object method shorthand closures through serialization", async () => {
    const source = [
      "const offset = 4;",
      "const service = { reset() { return offset + 1; } };",
      "await task();"
    ].join("\n");
    const module = parseModule(source);
    const closureNodeId = getNodeIdByType(module, "FunctionExpression");
    const awaitNodeId = getNodeIdByType(module, "AwaitExpression");
    const snapshot = serialize({
      source,
      currentAstNodeId: awaitNodeId,
      scopeChain: [
        {
          id: "module",
          bindings: {
            offset: 4,
            service: {
              reset: {
                kind: "fn",
                astNodeId: closureNodeId,
                capturedScopeId: "module"
              }
            }
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });

    const restored = restore(snapshot, { source, budget: new Budget() });
    const service = restored.currentScope.lookup("service");
    expect(service.found).toBe(true);
    if (!service.found || service.value === null || typeof service.value !== "object") {
      return;
    }

    const reset = (service.value as { reset?: { call?: (args: unknown[]) => unknown } }).reset;
    const result = reset?.call?.([]);
    expect(isSandboxPromise(result)).toBe(true);
    if (!isSandboxPromise(result)) {
      return;
    }

    await expect(result.promise).resolves.toBe(5);
  });

  it("round-trips an arrow capturing a method this binding", async () => {
    const source = [
      "const service = { value: 7, makeReader() { return () => this.value; } };",
      "await task();"
    ].join("\n");
    const module = parseModule(source);
    const arrowNodeId = getNodeIdByType(module, "ArrowFunctionExpression");
    const awaitNodeId = getNodeIdByType(module, "AwaitExpression");
    const snapshot = serialize({
      source,
      currentAstNodeId: awaitNodeId,
      scopeChain: [
        {
          id: "module",
          bindings: {}
        },
        {
          id: "method-call",
          parentId: "module",
          bindings: {
            this: {
              value: 7
            },
            reader: {
              kind: "fn",
              astNodeId: arrowNodeId,
              capturedScopeId: "method-call"
            }
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });

    const restored = restore(snapshot, { source, budget: new Budget() });
    const reader = restored.currentScope.lookup("reader");
    expect(reader.found).toBe(true);
    if (!reader.found || reader.value === null || typeof reader.value !== "object") {
      return;
    }

    const result = reader.value.call?.([], {
      stack: [],
      thisValue: { value: 99 }
    });
    expect(isSandboxPromise(result)).toBe(true);
    if (!isSandboxPromise(result)) {
      return;
    }

    await expect(result.promise).resolves.toBe(7);
  });

  it.each([
    ["function target(first, second) {}", "FunctionDeclaration", 2],
    ["function target(first, second = 2, third) {}", "FunctionDeclaration", 1],
    ["function target({ first = 1 }, ...rest) {}", "FunctionDeclaration", 1],
    ["function* target(first, second = 2) {}", "FunctionDeclaration", 1],
    ["const target = function named(first, ...rest) {};", "FunctionExpression", 1],
    ["const target = async (first = 1, second) => first;", "ArrowFunctionExpression", 0]
  ] as const)(
    "reconstructs source arity from snapshot AST: %s",
    (declaration, nodeType, length) => {
      const source = `${declaration}\nawait task();`;
      const module = parseModule(source);
      const snapshot = serialize({
        source,
        currentAstNodeId: getNodeIdByType(module, "AwaitExpression"),
        scopeChain: [
          {
            id: "module",
            bindings: {
              target: {
                kind: "fn",
                astNodeId: getNodeIdByType(module, nodeType),
                capturedScopeId: "module"
              }
            }
          }
        ],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      });
      const target = restore(snapshot, { source }).currentScope.lookup("target");
      expect(target.found).toBe(true);
      if (!target.found || !isSandboxClosure(target.value))
        throw new Error("Expected restored closure");
      expect(
        getFunctionMember(target.value, "length", {
          callClosure: () => {
            throw new Error("Reading arity must not invoke the closure");
          }
        })
      ).toBe(length);
    }
  );

  it("round-trips named function expression closures through serialization", async () => {
    const source = [
      "const factorial = async function check(value) { return value <= 1 ? 1 : value * await check(value - 1); };",
      "await task();"
    ].join("\n");
    const module = parseModule(source);
    const closureNodeId = getNodeIdByType(module, "FunctionExpression");
    const awaitNodeId = getNodeIdByType(module, "AwaitExpression");
    const snapshot = serialize({
      source,
      currentAstNodeId: awaitNodeId,
      scopeChain: [
        {
          id: "module",
          bindings: {
            factorial: {
              kind: "fn",
              astNodeId: closureNodeId,
              capturedScopeId: "module"
            }
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });

    expect(snapshot.scopeChain[0]?.bindings.factorial).toEqual({
      kind: "fn",
      astNodeId: closureNodeId,
      capturedScopeId: "module"
    });

    const restored = restore(snapshot, { source, budget: new Budget() });
    const factorial = restored.currentScope.lookup("factorial");
    expect(factorial.found).toBe(true);
    if (!factorial.found) {
      return;
    }

    const result = factorial.value.call?.([5]);
    expect(isSandboxPromise(result)).toBe(true);
    if (!isSandboxPromise(result)) {
      return;
    }
    await expect(result.promise).resolves.toBe(120);
    expect(restored.currentScope.lookup("check")).toEqual({ found: false });
  });

  it("restores a named function expression self-binding to the restored closure", async () => {
    const source = [
      "const factorial = async function check() { return check === factorial; };",
      "await task();"
    ].join("\n");
    const module = parseModule(source);
    const closureNodeId = getNodeIdByType(module, "FunctionExpression");
    const awaitNodeId = getNodeIdByType(module, "AwaitExpression");
    const snapshot = serialize({
      source,
      currentAstNodeId: awaitNodeId,
      scopeChain: [
        {
          id: "module",
          bindings: {
            factorial: {
              kind: "fn",
              astNodeId: closureNodeId,
              capturedScopeId: "module"
            }
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });

    const restored = restore(snapshot, { source, budget: new Budget() });
    const factorial = restored.currentScope.lookup("factorial");
    expect(factorial.found).toBe(true);
    if (!factorial.found) {
      return;
    }

    const result = factorial.value.call?.([]);
    expect(isSandboxPromise(result)).toBe(true);
    if (!isSandboxPromise(result)) {
      return;
    }
    await expect(result.promise).resolves.toBe(true);
  });

  it.each([
    "function add(value) { return value + base; }",
    "function add(value) { return arguments[0] + base; }",
    "function add(value, fallback = arguments[0]) { return fallback + base; }",
    "function add(value) { const read = () => arguments[0]; return read() + base; }"
  ])("round-trips function declaration closures: %s", async (declaration) => {
    const source = [declaration, "await task();"].join("\n");
    const module = parseModule(source);
    const closureNodeId = getNodeIdByType(module, "FunctionDeclaration");
    const awaitNodeId = getNodeIdByType(module, "AwaitExpression");
    const snapshot = serialize({
      source,
      currentAstNodeId: awaitNodeId,
      scopeChain: [
        {
          id: "module",
          bindings: {
            base: 40,
            add: {
              kind: "fn",
              astNodeId: closureNodeId,
              capturedScopeId: "module"
            }
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });

    const restored = restore(snapshot, {
      source,
      budget: new Budget()
    });
    const add = restored.currentScope.lookup("add");
    expect(add.found).toBe(true);
    if (!add.found) {
      return;
    }

    const result = add.value.call?.([2]);
    expect(isSandboxPromise(result)).toBe(true);
    if (!isSandboxPromise(result)) {
      return;
    }
    await expect(result.promise).resolves.toBe(42);
  });

  it("binds destructured parameters in restored async closures", async () => {
    const source = [
      "const collect = async ({ type, payload: { value = type }, ...meta }, [first, ...rest], { fallback = first } = {}) => { value = value + rest.length; return [value, meta.extra, fallback]; };",
      "await task();"
    ].join("\n");
    const module = parseModule(source);
    const closureNodeId = getNodeIdByType(module, "ArrowFunctionExpression");
    const awaitNodeId = getNodeIdByType(module, "AwaitExpression");
    const snapshot = serialize({
      source,
      currentAstNodeId: awaitNodeId,
      scopeChain: [
        {
          id: "module",
          bindings: {
            collect: {
              kind: "fn",
              astNodeId: closureNodeId,
              capturedScopeId: "module"
            }
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });

    const restored = restore(snapshot, { source, budget: new Budget() });
    const collect = restored.currentScope.lookup("collect");
    expect(collect.found).toBe(true);
    if (!collect.found) {
      return;
    }

    const result = collect.value.call?.([{ type: 5, payload: {}, extra: 9 }, [2, 3, 4]]);
    expect(isSandboxPromise(result)).toBe(true);
    if (!isSandboxPromise(result)) {
      return;
    }
    await expect(result.promise).resolves.toEqual([7, 9, 2]);
  });

  it("rebuilds scopes, call stack, modules, and the saved code pointer", async () => {
    const source = [
      'import * as time from "time";',
      "const closure = async () => base;",
      "await time.now();"
    ].join("\n");
    const module = parseModule(source);
    const closureNodeId = getNodeIdByType(module, "ArrowFunctionExpression");
    const awaitNodeId = getNodeIdByType(module, "AwaitExpression");
    const budget = new Budget();
    const controller = new AbortController();

    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId: awaitNodeId,
        scopeChain: [
          {
            id: "module",
            bindings: {
              base: 41,
              closure: {
                kind: "fn",
                astNodeId: closureNodeId,
                capturedScopeId: "module"
              },
              values: [
                "ok",
                {
                  kind: "undefined"
                }
              ]
            }
          }
        ],
        callStack: [
          {
            astNodeId: awaitNodeId,
            scopeId: "module",
            awaitingPromiseId: "promise-1"
          }
        ],
        pendingPromises: [
          {
            id: "promise-1",
            moduleId: "time",
            state: "pending",
            result: {
              kind: "undefined"
            }
          }
        ],
        moduleBindings: {
          time: "time"
        }
      },
      {
        source,
        modules: {
          time: {
            now: createSandboxClosure({
              async: true,
              call: () => 123
            })
          }
        },
        budget,
        signal: controller.signal
      }
    );

    expect(restored.sourceHash).toBe(hashSource(source));
    expect(restored.currentNode.nodeId).toBe(awaitNodeId);
    expect(restored.currentNode.type).toBe("AwaitExpression");
    expect(restored.budget).toBe(budget);
    expect(restored.signal).toBe(controller.signal);
    expect(restored.callStack).toHaveLength(1);
    expect(restored.callStack[0]).toMatchObject({
      astNodeId: awaitNodeId,
      scopeId: "module",
      awaitingPromiseId: "promise-1"
    });
    expect(restored.callStack[0]?.node.nodeId).toBe(awaitNodeId);
    expect(restored.callStack[0]?.scope).toBe(restored.currentScope);
    expect(restored.callStack[0]?.awaitingPromise).toBe(restored.pendingPromises[0]);
    expect(Object.prototype.toString.call(restored.pendingPromises[0])).toBe("[object Promise]");
    expect(restored.pendingPromises.map((promise) => ({ ...promise }))).toEqual([
      {
        id: "promise-1",
        moduleId: "time",
        resumePolicy: {
          kind: "re-issue"
        },
        state: "pending",
        result: undefined
      }
    ]);

    const base = restored.currentScope.lookup("base");
    expect(base).toMatchObject({
      found: true,
      value: 41
    });

    const values = restored.currentScope.lookup("values");
    expect(values).toMatchObject({
      found: true,
      value: ["ok", undefined]
    });

    const time = restored.currentScope.lookup("time");
    expect(time.found).toBe(true);
    if (!time.found) {
      return;
    }
    expect(Object.getPrototypeOf(time.value)).toBeNull();
    expect(time.value.now).toMatchObject({
      kind: "fn"
    });

    const closure = restored.currentScope.lookup("closure");
    expect(closure.found).toBe(true);
    if (!closure.found) {
      return;
    }
    expect(closure.value).toMatchObject({
      kind: "fn",
      astNodeId: closureNodeId,
      capturedScopeId: "module"
    });

    const promise = closure.value.call?.([]);
    expect(isSandboxPromise(promise)).toBe(true);
    if (!isSandboxPromise(promise)) {
      return;
    }
    await expect(promise.promise).resolves.toBe(41);
  });

  it("rejects snapshots whose source hash no longer matches the reparsed source", () => {
    const snapshot = {
      sourceHash: hashSource("await task()"),
      currentAstNodeId: 1,
      scopeChain: [],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    };

    expect(() =>
      restore(snapshot, {
        source: "await otherTask()",
        budget: new Budget()
      })
    ).toThrowError(
      `source changed since snapshot was taken (hash ${snapshot.sourceHash} expected, got ${hashSource("await otherTask()")}); pass --reset to discard`
    );
  });

  it("checks the source hash before parsing changed source", () => {
    const snapshot = {
      sourceHash: hashSource("return 1;"),
      currentAstNodeId: 1,
      scopeChain: [],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    };

    expect(() =>
      restore(snapshot, {
        source: "return {",
        budget: new Budget()
      })
    ).toThrowError(
      `source changed since snapshot was taken (hash ${snapshot.sourceHash} expected, but current source could not be hashed); pass --reset to discard`
    );
  });

  it("does not index AST nodes from inherited type and nodeId fields", () => {
    const source = "await task();";
    const awaitNodeId = getNodeIdByType(parseModule(source), "AwaitExpression");

    const restored = withObjectPrototypeProperties(
      {
        nodeId: awaitNodeId,
        type: "AwaitExpression"
      },
      () =>
        restore(
          {
            sourceHash: hashSource(source),
            currentAstNodeId: awaitNodeId,
            scopeChain: [
              {
                id: "module",
                bindings: {}
              }
            ],
            callStack: [],
            pendingPromises: [],
            moduleBindings: {}
          },
          {
            source,
            budget: new Budget()
          }
        )
    );

    expect(Object.hasOwn(restored.currentNode, "type")).toBe(true);
    expect(Object.hasOwn(restored.currentNode, "nodeId")).toBe(true);
    expect(restored.currentNode).toMatchObject({
      nodeId: awaitNodeId,
      type: "AwaitExpression"
    });
  });

  it("rejects snapshots when a saved module is no longer registered", () => {
    const source = 'import * as time from "time"; await time.now();';
    const awaitNodeId = getNodeIdByType(parseModule(source), "AwaitExpression");

    expect(() =>
      restore(
        {
          sourceHash: hashSource(source),
          currentAstNodeId: awaitNodeId,
          scopeChain: [
            {
              id: "module",
              bindings: {}
            }
          ],
          callStack: [],
          pendingPromises: [],
          moduleBindings: {
            time: "time"
          }
        },
        {
          source,
          budget: new Budget()
        }
      )
    ).toThrowError("Unknown module 'time'. No modules are registered.");
  });

  it("rejects snapshots when the saved code pointer no longer resolves", () => {
    const source = "await task()";

    expect(() =>
      restore(
        {
          sourceHash: hashSource(source),
          currentAstNodeId: 9999,
          scopeChain: [
            {
              id: "root",
              bindings: {}
            }
          ],
          callStack: [],
          pendingPromises: [],
          moduleBindings: {}
        },
        {
          source,
          budget: new Budget()
        }
      )
    ).toThrowError(
      expect.objectContaining({
        name: "SnapshotValidationError",
        path: "$.currentAstNodeId"
      })
    );
  });

  it("preserves null-prototype sandbox objects during restoration", () => {
    const source = "return value";

    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId: getNodeIdByType(parseModule(source), "Identifier"),
        scopeChain: [
          {
            id: "root",
            bindings: {
              value: {
                nested: 1
              }
            }
          }
        ],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      },
      {
        source,
        budget: new Budget()
      }
    );

    const value = restored.currentScope.lookup("value");
    expect(value.found).toBe(true);
    if (
      !value.found ||
      value.value === null ||
      typeof value.value !== "object" ||
      Array.isArray(value.value)
    ) {
      return;
    }

    expect(Object.getPrototypeOf(value.value)).toBeNull();
  });

  it("ignores inherited serialized value kind tags during restoration", () => {
    const source = "return value";

    withObjectPrototypeProperties(
      {
        kind: "undefined"
      },
      () => {
        const restored = restore(
          {
            sourceHash: hashSource(source),
            currentAstNodeId: getNodeIdByType(parseModule(source), "Identifier"),
            scopeChain: [
              {
                id: "root",
                bindings: {
                  value: {}
                }
              }
            ],
            callStack: [],
            pendingPromises: [],
            moduleBindings: {}
          },
          {
            source,
            budget: new Budget()
          }
        );

        const value = restored.currentScope.lookup("value");
        expect(value.found).toBe(true);
        expect(value.value).not.toBeUndefined();
        expect(value.value).toEqual({});
        expect(Object.getPrototypeOf(value.value as object)).toBeNull();
      }
    );
  });

  it("reuses the same runtime promise for every restored reference to a pending promise", () => {
    const source = "await task()";
    const awaitNodeId = getNodeIdByType(parseModule(source), "AwaitExpression");

    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId: awaitNodeId,
        scopeChain: [
          {
            id: "root",
            bindings: {
              task: {
                kind: "promise",
                id: "promise-1"
              }
            }
          }
        ],
        callStack: [
          {
            astNodeId: awaitNodeId,
            scopeId: "root",
            awaitingPromiseId: "promise-1"
          }
        ],
        pendingPromises: [
          {
            id: "promise-1",
            state: "pending"
          }
        ],
        moduleBindings: {}
      },
      {
        source,
        budget: new Budget()
      }
    );

    const task = restored.currentScope.lookup("task");
    expect(task.found).toBe(true);
    if (!task.found || typeof task.value !== "object" || task.value === null) {
      return;
    }

    expect(task.value).toBe(restored.pendingPromises[0]);
    expect(restored.callStack[0]?.awaitingPromise).toBe(restored.pendingPromises[0]);
  });

  it("restores circular sandbox objects through heap references", () => {
    const source = "return value";

    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId: getNodeIdByType(parseModule(source), "Identifier"),
        scopeChain: [
          {
            id: "root",
            bindings: {
              value: {
                kind: "ref",
                id: 1
              }
            }
          }
        ],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {},
        heap: {
          "1": {
            kind: "object",
            entries: {
              self: {
                kind: "ref",
                id: 1
              }
            }
          }
        }
      },
      {
        source,
        budget: new Budget()
      }
    );

    const value = restored.currentScope.lookup("value");
    expect(value.found).toBe(true);
    if (!value.found || value.value === null || typeof value.value !== "object") {
      return;
    }

    expect(value.value.self).toBe(value.value);
  });

  it("restores shared sandbox object identity", () => {
    const source = "return l === r";

    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId: getNodeIdByType(parseModule(source), "BinaryExpression"),
        scopeChain: [
          {
            id: "root",
            bindings: {
              l: {
                kind: "ref",
                id: 1
              },
              r: {
                kind: "ref",
                id: 1
              }
            }
          }
        ],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {},
        heap: {
          "1": {
            kind: "object",
            entries: {
              value: 42
            }
          }
        }
      },
      {
        source,
        budget: new Budget()
      }
    );

    const left = restored.currentScope.lookup("l");
    const right = restored.currentScope.lookup("r");

    expect(left.found).toBe(true);
    expect(right.found).toBe(true);
    if (!left.found || !right.found) {
      return;
    }

    expect(left.value).toBe(right.value);
  });

  it("annotates pending host calls with the resume policy", () => {
    const source = "await task()";
    const awaitNodeId = getNodeIdByType(parseModule(source), "AwaitExpression");

    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId: awaitNodeId,
        scopeChain: [
          {
            id: "root",
            bindings: {}
          }
        ],
        callStack: [],
        pendingPromises: [
          {
            id: "git-commit-1",
            moduleId: "git",
            operation: "commit",
            sideEffectTag: {
              kind: "host-call-side-effect",
              callId: "git-commit-1",
              moduleId: "git",
              operation: "commit"
            }
          },
          {
            id: "git-head-1",
            moduleId: "git",
            operation: "head"
          }
        ],
        moduleBindings: {}
      },
      {
        source,
        budget: new Budget()
      }
    );

    expect(restored.pendingPromises.map((promise) => promise.resumePolicy)).toEqual([
      {
        kind: "read-side-effect",
        sideEffectTag: {
          kind: "host-call-side-effect",
          callId: "git-commit-1",
          moduleId: "git",
          operation: "commit"
        }
      },
      {
        kind: "re-issue"
      }
    ]);
  });

  it("keeps restored pending promises in snapshot order", () => {
    const source = "await Promise.all([left, right])";
    const awaitNodeId = getNodeIdByType(parseModule(source), "AwaitExpression");

    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId: awaitNodeId,
        scopeChain: [
          {
            id: "root",
            bindings: {
              left: {
                kind: "promise",
                id: "left"
              },
              right: {
                kind: "promise",
                id: "right"
              }
            }
          }
        ],
        callStack: [],
        pendingPromises: [
          {
            id: "left",
            order: 1
          },
          {
            id: "right",
            order: 2
          }
        ],
        moduleBindings: {}
      },
      {
        source,
        budget: new Budget()
      }
    );

    expect(restored.pendingPromises.map((promise) => promise.id)).toEqual(["left", "right"]);
  });
});

function getNodeIdByType(module: Module, type: ParseResult["type"]): number {
  const match = findNode(module, (node): node is ParseResult => node.type === type);

  if (match?.nodeId === undefined) {
    throw new Error(`Expected node type '${type}' in test source.`);
  }

  return match.nodeId;
}

function getNodeIdsByType(module: Module, type: ParseResult["type"]): number[] {
  const ids: number[] = [];
  collectNodeIds(module, type, ids);
  return ids;
}

function restoreSuspendedGenerator(
  source: string,
  module: Module,
  input: {
    bindings: Record<string, unknown>;
    sent: unknown[];
    yieldNodeId: number;
  }
): SandboxGenerator {
  return restoreSuspendedGeneratorState(source, module, input).generator;
}

function restoreSuspendedGeneratorState(
  source: string,
  module: Module,
  input: {
    bindings: Record<string, unknown>;
    sent: unknown[];
    yieldNodeId: number;
  }
) {
  const generatorNodeId = getNodeIdByType(module, "FunctionDeclaration");
  const restored = restore(
    {
      sourceHash: hashSource(source),
      currentAstNodeId: getNodeIdByType(module, "AwaitExpression"),
      scopeChain: [
        { id: "module", bindings: {} },
        {
          id: "generator",
          parentId: "module",
          bindings: {
            ...input.bindings,
            generator: {
              kind: "generator",
              state: "suspended",
              astNodeId: generatorNodeId,
              capturedScopeId: "generator",
              yieldNodeId: input.yieldNodeId,
              sent: input.sent
            }
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    } as never,
    { source, budget: new Budget() }
  );
  const binding = restored.currentScope.lookup("generator");
  if (!binding.found || !isSandboxGenerator(binding.value)) {
    throw new Error("Expected restored generator binding.");
  }
  return { currentScope: restored.currentScope, generator: binding.value };
}

function program(source: string): ParseResult {
  const module = parseModule(source);
  return { type: "BlockStatement", body: module.body, span: module.span };
}

function collectNodeIds(value: unknown, type: ParseResult["type"], ids: number[]): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (
    "type" in value &&
    value.type === type &&
    "nodeId" in value &&
    typeof value.nodeId === "number"
  ) {
    ids.push(value.nodeId);
  }
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    collectNodeIds(entry, type, ids);
  }
}

function findNode<TNode extends { nodeId?: number; type: string }>(
  value: unknown,
  predicate: (node: TNode) => boolean
): TNode | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  if ("type" in value && typeof value.type === "string" && predicate(value as TNode)) {
    return value as TNode;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findNode(entry, predicate);
      if (match !== undefined) {
        return match;
      }
    }

    return undefined;
  }

  for (const entry of Object.values(value)) {
    const match = findNode(entry, predicate);
    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
}

describe("regex snapshots", () => {
  it("round-trips regex state and reparses the pattern", () => {
    const source = "export default 1";
    const regex = createSandboxRegex("a+", "g", 4);
    const snapshot = serialize({
      source,
      currentAstNodeId: 1,
      scopeChain: [{ id: 1, bindings: { regex } }],
      callStack: [],
      pendingPromises: []
    });
    const restored = restore(snapshot, { source });
    expect(restored.scopeChain[0]?.bindings.regex).toSatisfy(isSandboxRegex);
    expect(restored.scopeChain[0]?.bindings.regex).toMatchObject({
      kind: "regex",
      source: "a+",
      flags: "g",
      lastIndex: 4
    });
  });
});
