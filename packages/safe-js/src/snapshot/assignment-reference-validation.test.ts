import { assert, expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each(["primitive", "scope-as-object", "symbol-as-object", "missing-scope", "extra-object", "unknown-kind"])(
  "rejects forged assignment reference: %s", async alteration => {
    const source = "{function* values(){let x=1;x=yield 1;return x}const iterator=values();iterator.next();return iterator}";
    const ast = parseModule(source);
    const result = await interpret(ast.body[0]);
    assert(result.ok);
    const wire = serialize({source, currentAstNodeId: ast.body[0].nodeId!,
      scopeChain: [{id: "external", bindings: {iterator: result.returnValue as RuntimeSnapshotValue, token: Symbol("token")}}],
      callStack: [], pendingPromises: [], moduleBindings: {}});
    const generator = Object.values(wire.heap).find(node => node.kind === "guest-generator");
    assert(generator?.kind === "guest-generator");
    const expression = Object.values(generator.expressionStates ?? {}).find(state => state.kind === "identifier-assignment");
    assert(expression?.kind === "identifier-assignment");
    if (alteration === "primitive") Object.assign(expression, {referenceKind: "object", referenceObject: 7, referenceScope: undefined});
    if (alteration === "scope-as-object") {
      Object.assign(expression, {referenceKind: "object", referenceObject: expression.referenceScope});
      delete expression.referenceScope;
    }
    if (alteration === "symbol-as-object") {
      const symbol = Object.entries(wire.heap).find(([, node]) => node.kind === "symbol");
      assert(symbol);
      Object.assign(expression, {referenceKind: "object", referenceObject: {kind: "ref", id: Number(symbol[0])}});
      delete expression.referenceScope;
    }
    if (alteration === "missing-scope") delete expression.referenceScope;
    if (alteration === "extra-object") Object.assign(expression, {referenceObject: 7});
    if (alteration === "unknown-kind") Object.assign(expression, {referenceKind: "other"});
    expect(() => restore(JSON.parse(JSON.stringify(wire)), {source})).toThrow();
  }
);
