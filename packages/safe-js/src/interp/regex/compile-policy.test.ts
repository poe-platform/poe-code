import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Budget, SandboxError } from "../budget.js";
import {
  createSandboxRegex,
  deepCopyFromSandbox,
  isSandboxRegex,
  type SandboxValue
} from "../values.js";
import { parseRegex } from "./parse.js";
import { callStringMethod } from "../methods/string.js";
import { tokenize } from "../../parse/tokenizer.js";
import { run } from "../../run.js";
import * as parser from "../../parse/parser.js";
import * as hashing from "../../parse/hash.js";
import { serialize } from "../../snapshot/serialize.js";
import { restore as restoreInterpreterSnapshot } from "../../snapshot/restore.js";
import { dump } from "../../dump.js";
import { restore, type SafeJSSnapshot } from "../../restore.js";
import { declareHostOperation } from "../host-bridge.js";
import capture from "../../../test/fixtures/regexp-compile-hash-ea469.json" with { type: "json" };

const limits = vi.hoisted(() => ({ sourceLength: 32, flagsLength: 4, depth: 2, allocations: 256 }));
vi.mock("../budget.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../budget.js")>()),
  REGEX_COMPILE_LIMITS: limits
}));
beforeEach(() =>
  Object.assign(limits, { sourceLength: 32, flagsLength: 4, depth: 2, allocations: 256 })
);

describe("compile hash compatibility", () => {
  it.each([
    { name: "single regex return", source: "return /a/.source;", expected: "a" },
    {
      name: "multi-statement regex",
      source: "const regex = /a/g; return regex.flags;",
      expected: "g"
    },
    {
      name: "dormant function regex",
      source: "function dormant() { return /a/; } return 2;",
      expected: 2
    },
    {
      name: "standalone regex expression",
      source: "/a/g",
      expected: { source: "a", flags: "g", lastIndex: 0 }
    },
    { name: "numeric expression", source: "7", expected: 7 },
    { name: "plain return", source: "return 7;", expected: 7 },
    { name: "division", source: "return 6 / 2;", expected: 3 },
    { name: "slash-bearing string", source: 'return "/a/";', expected: "/a/" }
  ])("CONTROL legacy hash for $name", async ({ source, expected }) => {
    const legacyHash = hashing.hashSource(source);
    const result = await run(source, { budget: new Budget({ maxSteps: 1000 }) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.snapshot.sourceHash).toBe(legacyHash);
    if (typeof expected === "object") {
      expect(isSandboxRegex(result.returnValue)).toBe(true);
      expect(result.returnValue).toMatchObject(expected);
    } else {
      expect(result.returnValue).toBe(expected);
    }
  });

  it("CONTROL template substitutions preserve tagged and regex raw spelling", async () => {
    const fixtures = [
      {
        source:
          "function tag(parts, value) { return parts.raw[0] + value; } return tag`\\u0061${/a/.source}`;",
        expected: "\\u0061a"
      },
      {
        source:
          "function tag(parts, value) { return parts.raw[0] + value; } return tag`a${/a/.source}`;",
        expected: "aa"
      },
      { source: "return /a/.source;", expected: "a" },
      { source: "return /\\x61/.source;", expected: "\\x61" }
    ];
    const hashes: string[] = [];
    for (const { source, expected } of fixtures) {
      expect(runInNewContext(`(function () { ${source} })()`, {}, { timeout: 100 })).toBe(expected);
      const legacyHash = hashing.hashSource(source);
      const result = await run(source, { budget: new Budget({ maxSteps: 1000 }) });
      expect(result).toMatchObject({ ok: true, returnValue: expected });
      expect(result.snapshot.sourceHash).toBe(legacyHash);
      hashes.push(result.snapshot.sourceHash);
    }
    expect(hashes[0]).not.toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[3]);
  });

  it("CONTROL exported entrypoint hashes the module before default parameter execution", async () => {
    const source =
      "export default function read(pattern = /a/g) { return pattern.source + ':' + pattern.flags; }";
    const legacyHash = hashing.hashSource(source);
    const result = await run(source, {
      budget: new Budget({ maxSteps: 1000 }),
      entryPointArgs: []
    });
    expect(result).toMatchObject({ ok: true, returnValue: "a:g" });
    expect(result.snapshot.sourceHash).toBe(legacyHash);
  });

  it("CONTROL nested computed key parameter default and arrow body retain legacy hash", async () => {
    const source =
      "function read(pattern = /b/) { return pattern.source; } const get = () => /c/.source; return ({ [/a/.source]: read() + get() }).a;";
    expect(runInNewContext(`(function () { ${source} })()`, {}, { timeout: 100 })).toBe("bc");
    const legacyHash = hashing.hashSource(source);
    const result = await run(source, { budget: new Budget({ maxSteps: 1000 }) });
    expect(result).toMatchObject({ ok: true, returnValue: "bc" });
    expect(result.snapshot.sourceHash).toBe(legacyHash);
  });
});

describe("compile checkpoint hash compatibility", () => {
  it("CONTROL genuine EA pending and completed regex checkpoints retain hash and graphs", async () => {
    expect(capture.base).toBe("ea469259a7d61ab2839457863c445bd9f95155cb");
    expect(capture.expected).toEqual([true, "a", "g", 1, 17]);
    const source = capture.source;
    const completed: SafeJSSnapshot = capture.completed;
    expect(capture.pending.sourceHash).toBe(hashing.hashSource(source));
    expect(completed.sourceHash).toBe(capture.pending.sourceHash);
    expect(capture.pending).toMatchObject({
      replay: { calls: [{ operation: "wait", lifecycle: "running", policy: "re-issue" }] }
    });
    expect(capture.pending.replay.calls[0]).not.toHaveProperty("outcome");
    expect(capture.completed).toMatchObject({
      replay: {
        calls: [{ operation: "wait", lifecycle: "consumed", outcome: { status: "fulfilled" } }]
      }
    });
    const captureBytes = JSON.stringify(capture);
    for (const kind of ["pending", "completed"] as const) {
      const snapshot: SafeJSSnapshot = capture[kind];
      const before = JSON.stringify(snapshot);
      expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(snapshot, "sourceHash")).toEqual({
        value: completed.sourceHash,
        enumerable: true,
        configurable: true,
        writable: true
      });
      const waitCalls = vi.fn();
      const wait = async () => {
        waitCalls();
        return 17;
      };
      const provider = vi.fn();
      expect(restore(snapshot, { source })).toBe(snapshot);
      const result = await run(source, {
        snapshot,
        budget: new Budget({ maxSteps: 10000 }),
        bindings: { wait: declareHostOperation(wait, "re-issue") },
        hostCallResumeProvider: provider
      });
      expect(result).toMatchObject({ ok: true, returnValue: [true, "a", "g", 1, 17] });
      expect(result.snapshot.sourceHash).toBe(completed.sourceHash);
      const regex = result.snapshot.bindings.regex;
      const pair = result.snapshot.bindings.pair;
      expect(isSandboxRegex(regex)).toBe(true);
      expect(regex).toMatchObject({ source: "a", flags: "g", lastIndex: 1 });
      expect(Array.isArray(pair)).toBe(true);
      if (!Array.isArray(pair)) throw new Error("Missing genuine regex alias pair");
      expect(pair[0]).toBe(regex);
      expect(pair[1]).toBe(regex);
      const serialized: SafeJSSnapshot = JSON.parse(await dump(result));
      for (const field of [
        "bindings",
        "heap",
        "hostCalls",
        "replay",
        "promiseReplay",
        "initialInputs"
      ]) {
        expect(serialized[field], `${kind}/${field}`).toStrictEqual(completed[field]);
      }
      expect(waitCalls).toHaveBeenCalledTimes(kind === "pending" ? 1 : 0);
      expect(provider).not.toHaveBeenCalled();
      expect(JSON.stringify(snapshot)).toBe(before);
    }
    expect(JSON.stringify(capture)).toBe(captureBytes);
  });
});

describe("compile preimage policy", () => {
  it("RED fatal hash error is not retried as module syntax", () => {
    const fatal = new SandboxError({ budget: "deadline", current: 2, limit: 1 });
    const expression = vi.spyOn(parser, "parse").mockImplementation(() => {
      throw fatal;
    });
    const module = vi.spyOn(parser, "parseModule").mockImplementation(() => {
      throw new Error("unexpected retry");
    });
    let failure: unknown;
    let retries = 0;
    try {
      hashing.hashSource("1");
    } catch (error) {
      failure = error;
    } finally {
      retries = module.mock.calls.length;
      expression.mockRestore();
      module.mockRestore();
    }
    expect(failure).toBe(fatal);
    expect(failure).toMatchObject({
      code: "budgetExceeded",
      budget: "deadline",
      current: 2,
      limit: 1
    });
    expect(retries).toBe(0);
  });
  it("RED restore preserves fatal hash identity instead of source mismatch", () => {
    const source = "await task()";
    const snapshot = serialize({
      source,
      currentAstNodeId: parser.parseModule(source).body[0].nodeId!,
      scopeChain: [{ id: "module", bindings: {} }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    const fatal = new SandboxError({ budget: "deadline", current: 2, limit: 1 });
    const hash = vi.spyOn(hashing, "hashSource").mockImplementation(() => {
      throw fatal;
    });
    let failure: unknown;
    try {
      restoreInterpreterSnapshot(snapshot, { source });
    } catch (error) {
      failure = error;
    } finally {
      hash.mockRestore();
    }
    expect(failure).toBe(fatal);
    expect(failure).toMatchObject({
      code: "budgetExceeded",
      budget: "deadline",
      current: 2,
      limit: 1
    });
  });
  it("RED clone work reaches the existing deadline sample without masking it", () => {
    const regex = createSandboxRegex("a", "g");
    const budget = new Budget({ deadline: 1, maxSteps: 1_023 });
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    let failure: unknown;
    try {
      for (let visit = 0; visit < 1_023; visit += 1) budget.visitNode();
      clock.mockReturnValue(2);
      callStringMethod("", "matchAll", [regex], budget);
    } catch (error) {
      failure = error;
    } finally {
      clock.mockRestore();
    }
    expect(failure).toBeInstanceOf(SandboxError);
    expect(failure).toMatchObject({
      code: "budgetExceeded",
      budget: "deadline",
      current: 2,
      limit: 1
    });
    expect(budget.stepsUsed).toBe(1_024);
    expect(budget.currentDataSize).toBe(0);
  });
  it.each(["console", "import"] as const)("CONTROL run-owned %s native copy", async (bridge) => {
    const sink = vi.fn();
    const source =
      bridge === "console"
        ? "console.log(/a/g); return 1"
        : "import { take } from 'host'; take(/a/g); return 1";
    await expect(
      run(source, { sink: { log: sink, error: sink }, modules: { host: { take: sink } } })
    ).resolves.toMatchObject({ ok: true, returnValue: 1 });
    expect(sink).toHaveBeenCalledTimes(1);
    const native = sink.mock.calls[0][0] as RegExp;
    expect(native).toBeInstanceOf(RegExp);
    expect([native.source, native.flags, native.lastIndex]).toEqual(["a", "g", 0]);
  });
  it.each(["console", "import"] as const)(
    "RED %s native refusal precedes pure sink",
    async (bridge) => {
      const sink = vi.fn();
      const arm = vi.fn(() => {
        limits.sourceLength = 2;
      });
      const source =
        bridge === "console"
          ? "const value = RegExp('abc'); arm(); console.log(value); return 1"
          : "import { take } from 'host'; const value = RegExp('abc'); arm(); take(value); return 1";
      let failure: unknown;
      await run(source, {
        bindings: { arm },
        sink: { log: sink, error: sink },
        modules: { host: { take: sink } }
      }).catch((error: unknown) => {
        failure = error;
      });
      expect(arm).toHaveBeenCalledTimes(1);
      expect(failure).toBeInstanceOf(SandboxError);
      expect(failure).toMatchObject({
        code: "budgetExceeded",
        budget: "stringLength",
        current: 3,
        limit: 2
      });
      expect(sink).not.toHaveBeenCalled();
    }
  );
  it("CONTROL host-mutated primitive regex fields retain native export descriptors", () => {
    const regex = createSandboxRegex("a", "g");
    Reflect.set(regex, "source", "b");
    Reflect.set(regex, "flags", "i");
    const cursor = { [Symbol.toPrimitive]: vi.fn(() => 0) };
    Object.defineProperty(regex, "lastIndex", { value: cursor });
    const native = deepCopyFromSandbox(regex) as RegExp;
    expect([native.source, native.flags]).toEqual(["b", "i"]);
    expect(Object.getOwnPropertyDescriptor(native, "lastIndex")).toEqual({
      value: cursor,
      writable: true,
      enumerable: false,
      configurable: false
    });
    expect(cursor[Symbol.toPrimitive]).not.toHaveBeenCalled();
  });
  it("RED source ceiling", () => {
    limits.sourceLength = 3;
    expect(parseRegex("abc").source).toBe("abc");
    expect(() => parseRegex("abcd")).toThrow(SandboxError);
  });
  it("RED flag ceiling", () => {
    limits.flagsLength = 1;
    expect(parseRegex("a", "g").flags.global).toBe(true);
    expect(() => parseRegex("a", "gi")).toThrow(SandboxError);
  });
  it("RED group depth ceiling", () => {
    expect(parseRegex("((a))").captureCount).toBe(2);
    expect(() => parseRegex("(((a)))")).toThrow(SandboxError);
  });
  it("RED cumulative structural allocation", () => {
    limits.allocations = 29;
    expect(parseRegex("a").body).toEqual({ type: "literal", value: "a" });
    expect(() => parseRegex("ab")).toThrow(SandboxError);
  });
  it.each(["return RegExp('abcd')", "return new RegExp('abcd')"])(
    "RED constructor %s",
    async (source) => {
      limits.sourceLength = 3;
      await expect(run(source)).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "stringLength",
        current: 4,
        limit: 3
      });
    }
  );
  it.each(["arrayLength", "dataSize"] as const)("RED clone compiler caller %s", (limit) => {
    const regex = createSandboxRegex("ab", "g");
    const budget = new Budget({ [limit]: 1 });
    expect(() => callStringMethod("", "matchAll", [regex], budget)).toThrow(SandboxError);
  });
  it("RED cumulative physical work across two compiles", () => {
    const regex = createSandboxRegex("a", "g");
    const budget = new Budget({ maxSteps: 60 });
    expect(() => callStringMethod("", "matchAll", [regex], budget)).not.toThrow();
    expect(() => callStringMethod("", "matchAll", [regex], budget)).toThrow(SandboxError);
  });
  it("RED CRLF width before literal allocation", () => {
    limits.sourceLength = 2;
    expect(() => tokenize("/a\r\n/", { allowRegexLiterals: true })).toThrow(SandboxError);
  });
  it("RED native export source preflight", () => {
    const regex = createSandboxRegex("abc");
    limits.sourceLength = 2;
    const native = vi.spyOn(globalThis, "RegExp");
    let failure: unknown;
    let calls = 0;
    try {
      deepCopyFromSandbox(regex);
    } catch (error) {
      failure = error;
    } finally {
      calls = native.mock.calls.length;
      native.mockRestore();
    }
    expect(failure).toBeInstanceOf(SandboxError);
    expect(calls).toBe(0);
  });
  it.each(["accessor", "proxy"] as const)(
    "RED native export rejects %s without passive hooks",
    (kind) => {
      const regex = createSandboxRegex("a");
      const hook = vi.fn(() => "a");
      const value =
        kind === "accessor"
          ? (Object.create(null, {
              ...Object.getOwnPropertyDescriptors(regex),
              source: { get: hook, enumerable: true }
            }) as SandboxValue)
          : new Proxy(regex, {
              get: (target, key, receiver) => {
                hook();
                return Reflect.get(target, key, receiver);
              }
            });
      let failure: unknown;
      try {
        deepCopyFromSandbox(value);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(TypeError);
      expect(hook).not.toHaveBeenCalled();
    }
  );
  it("CONTROL supported grammar, captures, raw cursor and native alias behavior", () => {
    expect(parseRegex("(a)", "g").captureCount).toBe(1);
    expect(() => parseRegex("a", "u")).toThrow(SyntaxError);
    expect(() => parseRegex("a", "y")).toThrow(SyntaxError);
    const regex = createSandboxRegex("a", "g", 2);
    const cursor = { [Symbol.toPrimitive]: vi.fn(() => 0) };
    Object.defineProperty(regex, "lastIndex", { value: cursor });
    const copy = deepCopyFromSandbox([regex, regex]) as RegExp[];
    expect(copy[0]).toBe(copy[1]);
    expect(copy[0].source).toBe("a");
    expect(copy[0].flags).toBe("g");
    expect(copy[0].lastIndex).toBe(cursor);
    expect(cursor[Symbol.toPrimitive]).not.toHaveBeenCalled();
  });
});
