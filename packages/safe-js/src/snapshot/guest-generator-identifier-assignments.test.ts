import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";

const bodies = [
  "let value=2;value+=(value=10,yield 1);return value",
  "let value=2;value*=(value=10,yield 1);return value",
  "let value=2;value&&=(value=0,yield 1);return value",
  "let value=0;value||=(value=10,yield 1);return value",
  "let value=null;value??=(value=10,yield 1);return value",
  "let value=2;value=(value=10,yield 1);return value",
  "let value={valueOf(){return 2}};value+=(value=null,yield 1);return value"
];

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "retains identifier assignment's previous value: $body (async=$async)", async ({ body, async }) => {
  const source = `{${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  const wire = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { iterator: original.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(wire)), { source });
  const binding = restored.currentScope.lookup("iterator");
  if (!binding.found) throw new Error("Missing iterator");
  const next = await interpret(parseModule("{return iterator.next(4)}").body[0], {
    budget: restored.budget, bindings: { iterator: binding.value }
  });
  if (!next.ok) throw new Error(next.error.message);
  const actual = isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
  const native = await runInNewContext(`(async()=>${source})()`);
  expect(actual).toEqual(await native.next(4));
});
