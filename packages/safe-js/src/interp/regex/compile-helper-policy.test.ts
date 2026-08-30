import { beforeEach, describe, expect, it, vi } from "vitest";
import { Budget, SandboxError } from "../budget.js";
import {
  createSandboxRegex,
  deepCopyFromSandbox,
  isSandboxRegex,
  type SandboxValue
} from "../values.js";
import { CompileScope } from "./compile-guard.js";
import { parseRegex } from "./parse.js";
import { run } from "../../run.js";
import { tokenize } from "../../parse/tokenizer.js";
import { callStringMethod } from "../methods/string.js";
import { parseModule } from "../../parse/parser.js";
import { serialize } from "../../snapshot/serialize.js";
import { restore as restoreInterpreterSnapshot } from "../../snapshot/restore.js";
import { validateInterpreterSnapshot } from "../../snapshot/validation.js";

const limits = vi.hoisted(() => ({ sourceLength: 32, flagsLength: 4, depth: 2, allocations: 256 }));

vi.mock("../budget.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../budget.js")>()),
  REGEX_COMPILE_LIMITS: limits
}));

beforeEach(() => {
  Object.assign(limits, { sourceLength: 32, flagsLength: 4, depth: 2, allocations: 256 });
});

describe("compile policy drafts", () => {
  it("guards admitted snapshot regex reconstruction and releases the owner for positive restore", () => {
    const source = "await task()";
    const statement = parseModule(source).body[0];
    if (
      statement.type !== "ExpressionStatement" ||
      statement.expression.type !== "AwaitExpression" ||
      statement.expression.argument.type !== "CallExpression"
    ) {
      throw new Error("Missing expected await-call AST");
    }
    const nodes = [
      statement,
      statement.expression,
      statement.expression.argument,
      statement.expression.argument.callee
    ];
    const nodeById = new Map(nodes.map((node) => [node.nodeId!, node]));
    const snapshot = serialize({
      source,
      currentAstNodeId: statement.nodeId!,
      scopeChain: [{ id: "module", bindings: { regex: createSandboxRegex("abc") } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    expect(snapshot.scopeChain[0].bindings.regex).toStrictEqual({
      kind: "regex",
      source: "abc",
      flags: "",
      lastIndex: 0
    });
    const snapshotBytes = JSON.stringify(snapshot);
    const budget = new Budget();
    const initialData = budget.currentDataSize;
    limits.sourceLength = 2;
    try {
      expect(() => validateInterpreterSnapshot(snapshot, nodeById, budget)).not.toThrow();
      let failure: unknown;
      try {
        restoreInterpreterSnapshot(snapshot, { source, budget });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(SandboxError);
      expect(failure).toMatchObject({
        code: "budgetExceeded",
        budget: "stringLength",
        current: 3,
        limit: 2
      });
      expect(budget.currentDataSize).toBe(initialData);
      expect(JSON.stringify(snapshot)).toBe(snapshotBytes);
    } finally {
      limits.sourceLength = 32;
    }
    const restored = restoreInterpreterSnapshot(snapshot, { source, budget });
    const lookup = restored.currentScope.lookup("regex");
    if (!lookup.found) throw new Error("Missing restored regex");
    expect(isSandboxRegex(lookup.value)).toBe(true);
    expect(lookup.value).toMatchObject({ source: "abc", flags: "", lastIndex: 0 });
    expect(JSON.stringify(snapshot)).toBe(snapshotBytes);
    const operation = budget.acquireCompileOwner();
    operation.release();
  });

  it("checks caller array capacity before another AST slot", () => {
    const budget = new Budget({ arrayLength: 1 });
    const operation = budget.acquireCompileOwner();
    const compilation = new CompileScope(operation.owner);
    try {
      expect(() => createSandboxRegex("ab", "", 0, compilation)).toThrow(SandboxError);
    } finally {
      compilation.dispose();
      operation.release();
    }
    expect(budget.currentDataSize).toBe(0);
  });

  it.each(["split", "matchAll"] as const)("guards the %s clone before matching", (method) => {
    const regex = createSandboxRegex("ab", "g");
    const budget = new Budget({ stringLength: 1 });
    expect(() => callStringMethod("ab", method, [regex], budget)).toThrow(SandboxError);
    expect(budget.currentDataSize).toBe(0);
  });

  it("checks both CRLF code units before advancing the literal scanner", () => {
    limits.sourceLength = 2;
    expect(() => tokenize("/a\r\n/", { allowRegexLiterals: true })).toThrow(SandboxError);
  });

  it.each(["return RegExp('abcd')", "return new RegExp('abcd')"])(
    "applies the internal source ceiling to %s",
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
  it("refuses source and flag growth before parsing", () => {
    limits.sourceLength = 3;
    expect(parseRegex("abc").source).toBe("abc");
    expect(() => parseRegex("abcd")).toThrow(SandboxError);
    limits.flagsLength = 1;
    expect(parseRegex("a", "g").flags.global).toBe(true);
    expect(() => parseRegex("a", "gi")).toThrow(SandboxError);
  });

  it("bounds recursion without changing capture numbering", () => {
    expect(parseRegex("((a))").captureCount).toBe(2);
    expect(() => parseRegex("(((a)))")).toThrow(SandboxError);
    expect(() => parseRegex("a", "y")).toThrow(SyntaxError);
    expect(() => parseRegex("a", "u")).toThrow(SyntaxError);
  });

  it("checks cumulative allocation before another sequence node", () => {
    limits.allocations = 29;
    expect(parseRegex("a").body).toEqual({ type: "literal", value: "a" });
    expect(() => parseRegex("ab")).toThrow(SandboxError);
  });

  it("charges repeated physical compilations to the same work budget", () => {
    const baseline = new Budget();
    const first = baseline.acquireCompileOwner();
    const scope = new CompileScope(first.owner);
    try {
      createSandboxRegex("a", "", 0, scope);
    } finally {
      scope.dispose();
      first.release();
    }
    const budget = new Budget({ maxSteps: baseline.stepsUsed * 2 - 1 });
    const operation = budget.acquireCompileOwner();
    const compilation = new CompileScope(operation.owner);
    try {
      createSandboxRegex("a", "", 0, compilation);
      expect(() => createSandboxRegex("a", "", 0, compilation)).toThrow(SandboxError);
    } finally {
      compilation.dispose();
      operation.release();
    }
    expect(budget.currentDataSize).toBe(0);
  });

  it("retains hard caps while ordinary Budget checks are suspended", () => {
    const budget = new Budget();
    const operation = budget.acquireCompileOwner();
    const compilation = new CompileScope(operation.owner);
    const resume = budget.suspendChecks();
    try {
      expect(() => createSandboxRegex("(((a)))", "", 0, compilation)).toThrow(SandboxError);
    } finally {
      resume();
      compilation.dispose();
      operation.release();
    }
  });

  it("preflights native export before invoking its constructor", () => {
    const regex = createSandboxRegex("abc");
    limits.sourceLength = 2;
    const native = vi.spyOn(globalThis, "RegExp");
    try {
      expect(() => deepCopyFromSandbox(regex)).toThrow(SandboxError);
      expect(native).not.toHaveBeenCalled();
    } finally {
      native.mockRestore();
    }
  });

  it("refuses malformed own data without accessors or coercion", () => {
    const regex = createSandboxRegex("a");
    const hook = vi.fn(() => {
      throw new Error("passive hook");
    });
    const properties = Object.getOwnPropertyDescriptors(regex);
    const accessor = Object.create(null, {
      ...properties,
      source: { get: hook, enumerable: true }
    }) as SandboxValue;
    const coercible = Object.create(null, {
      ...properties,
      flags: { value: { [Symbol.toPrimitive]: hook }, enumerable: true }
    }) as SandboxValue;
    const proxy = new Proxy(regex, {
      get: hook,
      has: hook,
      getOwnPropertyDescriptor: hook,
      getPrototypeOf: hook,
      ownKeys: hook
    });
    const native = vi.spyOn(globalThis, "RegExp");
    try {
      expect(() => deepCopyFromSandbox(accessor)).toThrow(TypeError);
      expect(() => deepCopyFromSandbox(coercible)).toThrow(TypeError);
      expect(() => deepCopyFromSandbox(proxy)).toThrow(TypeError);
      expect(hook).not.toHaveBeenCalled();
      expect(native).not.toHaveBeenCalled();
    } finally {
      native.mockRestore();
    }
  });

  it("preserves native source, flags, raw cursors and existing copy alias behavior", () => {
    const regex = createSandboxRegex("a", "g", 2);
    const cursor = {
      [Symbol.toPrimitive]: vi.fn(() => {
        throw new Error("coerced");
      })
    };
    Object.defineProperty(regex, "lastIndex", { value: cursor });
    const copied = deepCopyFromSandbox([regex, regex]) as RegExp[];
    expect(copied[0]).toBe(copied[1]);
    expect(copied[0].source).toBe("a");
    expect(copied[0].flags).toBe("g");
    expect(copied[0].lastIndex).toBe(cursor);
    expect(cursor[Symbol.toPrimitive]).not.toHaveBeenCalled();
  });
});
