import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { parseModule } from "../../parse/parser.js";
import { decodeReplayData, encodeReplayData } from "../../snapshot/replay-data.js";
import { restore } from "../../snapshot/restore.js";
import { serialize } from "../../snapshot/serialize.js";
import { Budget, SandboxError } from "../budget.js";
import { createSubsetErrorValue } from "../exceptions.js";
import { deepCopyToSandbox } from "../values.js";
import { createObjectArrayGlobals } from "./object-array.js";

const originalSource =
  'try { throw new TypeError("example failure"); } catch (error) { return { receiver: typeof error, errorName: error.name, errorMessage: error.message, errorString: String(error) }; }';

describe("String coercion of supported errors", () => {
  it("preserves the exact README review observation and native result", async () => {
    const native = new Function(originalSource)();
    expect(native).toEqual({
      receiver: "object",
      errorName: "TypeError",
      errorMessage: "example failure",
      errorString: "TypeError: example failure"
    });

    const result = await run(originalSource);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(native);
  });

  describe.each([
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "AggregateError"
  ])("%s", (name) => {
    it.each(["", "new "])("coerces %sconstruction with and without a message", async (prefix) => {
      const errors = name === "AggregateError" ? "[], " : "";
      const source = `const failure = ${prefix}${name}(${errors}"example failure");
        const empty = ${prefix}${name}(${name === "AggregateError" ? "[]" : ""});
        return [String(failure), String(empty), failure.name, failure.message];`;
      const native = new Function(source)();
      expect(native).toEqual([`${name}: example failure`, name, name, "example failure"]);
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toEqual(native);
    });
  });

  it.each([
    ['""', '"message"', "message"],
    ['"Renamed"', '""', "Renamed"],
    ['""', '""', ""],
    ["undefined", "undefined", "Error"],
    ["null", "0", "null: 0"],
    ["42", "false", "42: false"],
    ['"TypeError"', '"雪😀"', "TypeError: 雪😀"]
  ])("reads current name %s and message %s", async (name, message, expected) => {
    const source = `const failure = new TypeError("before");
      failure.name = ${name}; failure.message = ${message}; return String(failure);`;
    expect(new Function(source)()).toBe(expected);
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toBe(expected);
  });

  it("coerces a caught intrinsic error without changing its failure channel", async () => {
    const source = "try { String.fromCodePoint(-1); } catch (error) { return String(error); }";
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toBe(new Function(source)());
  });

  it("retains existing primitive and array coercion", async () => {
    const source = `return [
      String(null), String(undefined), String(false), String(12), String([1, null, 3])
    ];`;
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(new Function(source)());
  });

  it("does not infer an error brand from ordinary object fields", async () => {
    const value = {
      name: "TypeError",
      message: "example failure",
      stack: "TypeError: example failure"
    };
    const globals = createObjectArrayGlobals({ budget: new Budget() });
    expect(await globals.String.call([value])).toBe(String(value));
    expect(await globals.String.call([value])).toBe("[object Object]");
  });

  it("closes the separately observed guest object conversion failure", async () => {
    const source = "return String({});";
    expect(new Function(source)()).toBe("[object Object]");
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toBe("[object Object]");
  });

  it.each(["undefined", "null", "7"])(
    "rejects a noncallable own toString value %s",
    async (value) => {
      const source = `const failure = new TypeError("example failure");
        failure.toString = ${value}; return String(failure);`;
      await expect(run(source)).rejects.toMatchObject({
        name: "TypeError",
        message: "Cannot convert object to primitive value"
      });
    }
  );

  it("preserves the existing error brand through copy and in-memory replay and snapshot restore", async () => {
    const failure = createSubsetErrorValue("TypeError", "example failure", [], new Budget()) as {
      name: string;
      message: string;
      stack: string;
    };
    expect(Object.keys(failure)).toEqual(["name", "message", "stack"]);
    const copied = deepCopyToSandbox(failure);
    const replayed = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(failure))));
    const source = "return 0;";
    const snapshot = serialize({
      source,
      currentAstNodeId: parseModule(source).body[0].nodeId!,
      scopeChain: [{ id: "module", bindings: { failure } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source }).currentScope.lookup(
      "failure"
    );
    expect(binding.found).toBe(true);
    if (!binding.found) throw new Error("Missing restored error");

    const globals = createObjectArrayGlobals({ budget: new Budget() });
    for (const value of [failure, copied, replayed, binding.value]) {
      expect(await globals.String.call([value])).toBe("TypeError: example failure");
    }
  });

  it("keeps converted error strings subject to the existing string budget", async () => {
    const failure = createSubsetErrorValue("TypeError", "example failure", [], new Budget());
    const globals = createObjectArrayGlobals({ budget: new Budget({ stringLength: 20 }) });
    await expect(Promise.resolve().then(() => globals.String.call([failure]))).rejects.toThrow(
      SandboxError
    );
    await expect(Promise.resolve().then(() => globals.String.call([failure]))).rejects.toThrow(
      "stringLength: 26 > 20"
    );
  });
});
