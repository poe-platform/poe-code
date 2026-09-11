import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { getFunctionMember } from "../interp/methods/function.js";
import { isSandboxClosure } from "../interp/values.js";
import { hashSource } from "../parse/hash.js";
import { parseModule } from "../parse/parser.js";
import { restore as restoreDump } from "../restore.js";
import { EXECUTION_SEMANTICS, serializeSafeJSSnapshot } from "./dump-format.js";
import { restore } from "./restore.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";

describe.each(["interpreter", "dump"])("NUM → OBJ002 combined %s restoration", (format) => {
  it.each([
    ["function({ value = 1 }, next = 2, ...rest) {}", 1],
    ["([first = 1], { second = 2 }, third) => first", 3],
    ["async function(first, ...rest) {}", 1],
    ["function*(first = 1, second) {}", 0]
  ])("retains sparse graph shape and source arity for %s", async (expression, length) => {
    expect(runInNewContext(`(${expression}).length`, {}, { timeout: 1_000 })).toBe(length);
    const source = `const target = ${expression}; await 0;`;
    const module = parseModule(source);
    const declaration = module.body[0];
    const statement = module.body[1];
    if (declaration?.type !== "VariableDeclaration" || statement?.type !== "ExpressionStatement")
      throw new Error("Expected declaration and await statement");
    const closureNode = declaration.declarations[0]?.init;
    if (closureNode?.nodeId === undefined || statement.expression.nodeId === undefined)
      throw new Error("Expected source node IDs");
    const metadata = { count: 7 };
    const rows = Object.assign(new Array<RuntimeSnapshotValue>(6), {
      metadata,
      raw: metadata,
      self: undefined as RuntimeSnapshotValue
    });
    rows[1] = {
      kind: "fn",
      astNodeId: closureNode.nodeId,
      capturedScopeId: "module"
    };
    rows[4] = undefined;
    rows.self = rows;
    const input = {
      source,
      currentAstNodeId: statement.expression.nodeId,
      scopeChain: [{ id: "module", bindings: { rows, alias: rows, metadata } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    };
    let encoded = JSON.parse(JSON.stringify(serialize(input)));
    if (format === "dump") {
      const envelope = JSON.parse(
        serializeSafeJSSnapshot({
          sourceHash: hashSource(source),
          executionSemantics: EXECUTION_SEMANTICS,
          bindings: input.scopeChain[0]!.bindings
        })
      );
      expect(envelope.version).toBe(2);
      const validated = restoreDump(envelope, { source });
      encoded = {
        ...encoded,
        scopeChain: [{ id: "module", bindings: validated.bindings }],
        heap: validated.heap
      };
    }
    const scope = restore(encoded, { source }).currentScope;
    const binding = scope.lookup("rows");
    const alias = scope.lookup("alias");
    const restoredMetadata = scope.lookup("metadata");
    if (!binding.found || !alias.found || !restoredMetadata.found)
      throw new Error("Expected all restored bindings");
    const actual = binding.value as typeof rows;
    expect(actual).not.toBe(rows);
    expect(actual.length).toBe(6);
    expect(Object.keys(actual)).toEqual(["1", "4", "metadata", "raw", "self"]);
    expect(Array.from({ length: 6 }, (_, index) => Object.hasOwn(actual, index))).toEqual([
      false,
      true,
      false,
      false,
      true,
      false
    ]);
    expect(actual[4]).toBeUndefined();
    expect(actual).toBe(alias.value);
    expect(actual.self).toBe(actual);
    expect(actual.metadata).toBe(restoredMetadata.value);
    expect(actual.raw).toBe(actual.metadata);
    expect(actual.metadata.count).toBe(7);
    const target = actual[1];
    if (!isSandboxClosure(target)) throw new Error("Expected restored source closure");
    const options = { callClosure: vi.fn() };
    expect(getFunctionMember(target, "length", options)).toBe(length);
    const bind = getFunctionMember(target, "bind", options);
    if (!isSandboxClosure(bind)) throw new Error("Expected bind method");
    const bound = await bind.call([null, 1], { stack: [], thisValue: target });
    if (!isSandboxClosure(bound)) throw new Error("Expected bound closure");
    expect(getFunctionMember(bound, "length", options)).toBe(Math.max(0, length - 1));
    const bindAgain = getFunctionMember(bound, "bind", options);
    if (!isSandboxClosure(bindAgain)) throw new Error("Expected rebound method");
    const rebound = await bindAgain.call([null, 2, 3], { stack: [], thisValue: bound });
    if (!isSandboxClosure(rebound)) throw new Error("Expected rebound closure");
    expect(getFunctionMember(rebound, "length", options)).toBe(0);
    expect(options.callClosure).not.toHaveBeenCalled();
  });
});
