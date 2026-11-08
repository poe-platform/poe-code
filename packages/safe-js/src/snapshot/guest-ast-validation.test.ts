import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreDump } from "../restore.js";

const body = "function* first(){yield 1}function* second(){yield 2}const a=first();const b=second();a.next();b.next();";

it.each(["missing", "wrong-node", "wrong-index"])("rejects corrupted expression continuation %s", async corruption => {
  const source = "{function* values(){const result=[1,yield 2];yield result}const iterator=values();iterator.next();return iterator}";
  const ast = parseModule(source);
  const result = await interpret(ast.body[0]);
  if (!result.ok) throw new Error(result.error.message);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { iterator: result.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const generator = Object.values(snapshot.heap!).find(node => node.kind === "guest-generator")!;
  const [id, expression] = Object.entries(generator.expressionStates!).find(([, entry]) => entry.kind === "array")!;
  if (corruption === "missing") generator.expressionStates = {};
  else if (corruption === "wrong-node") generator.expressionStates = { [generator.astNodeId]: expression };
  else if (expression.kind === "array") generator.expressionStates![id] = { ...expression, index: 0 };
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), { source })).toThrow("Invalid generator AST identity");
});

it.each(["yield", "block", "missing-block", "finally"])("rejects invalid low-level generator %s ownership", async corruption => {
  const source = `{${body}return [a,b]}`;
  const ast = parseModule(source);
  const result = await interpret(ast.body[0]);
  if (!result.ok) throw new Error(result.error.message);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { pair: result.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const generators = Object.values(snapshot.heap!).filter(node => node.kind === "guest-generator");
  expect(generators).toHaveLength(2);
  if (corruption === "yield") generators[0].yieldNodeId = generators[1].yieldNodeId;
  else if (corruption === "block") generators[0].blockScopes = generators[1].blockScopes;
  else if (corruption === "missing-block") generators[0].blockScopes = {};
  else generators[0].finallyCompletions = { [generators[1].astNodeId]: { kind: "return", hasValue: true, value: 17 } };
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), { source })).toThrow("Invalid generator AST identity");
});

it("rejects a public generator claiming a block owned by another generator", async () => {
  const source = `${body}return 3`;
  const pending = run(source);
  await pending;
  const snapshot = JSON.parse(await dump(pending));
  const first = snapshot.heap[snapshot.bindings.a.id];
  const second = snapshot.heap[snapshot.bindings.b.id];
  first.blockScopes = second.blockScopes;
  expect(() => restoreDump(snapshot, { source })).toThrow("Invalid generator AST identity");
});
