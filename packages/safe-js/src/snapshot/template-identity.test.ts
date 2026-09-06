import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";
import { hashSource } from "../parse/hash.js";
import { restore as restoreDump } from "../restore.js";

it.each(["node", "text", "writable", "raw", "duplicate", "owner"].flatMap(mutation =>
  [false, true].map(publicDump => ({ mutation, publicDump }))))(
  "rejects forged template metadata: $mutation (public=$publicDump)", async ({ mutation, publicDump }) => {
    const source = '{function tag(s){return s}return tag`x`}';
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
    if (!original.ok) throw new Error(original.error.message);
    const wire = publicDump
      ? JSON.parse(serializeSafeJSSnapshot({ sourceHash: hashSource(source), bindings: { saved: original.returnValue } }))
      : serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
        scopeChain: [{ id: "external", bindings: { saved: original.returnValue as RuntimeSnapshotValue } }],
        callStack: [], pendingPromises: [], moduleBindings: {} });
    const heap = wire.heap as Record<string, { kind: string; templateNodeId?: number; templateOwner?: unknown; state: { properties: { properties: Array<[string, Record<string, unknown>]> } } }>;
    const template = Object.values(heap).find(node => node.templateNodeId !== undefined)!;
    const properties = template.state.properties.properties;
    if (mutation === "node") template.templateNodeId = ast.body[0].nodeId;
    if (mutation === "text") properties.find(([key]) => key === "0")![1].value = "forged";
    if (mutation === "writable") properties.find(([key]) => key === "0")![1].writable = true;
    if (mutation === "raw" || mutation === "owner") {
      const raw = properties.find(([key]) => key === "raw")![1].value as { id: number };
      if (mutation === "raw") heap[String(raw.id)].state.properties.properties.find(([key]) => key === "0")![1].value = "forged";
      else delete heap[String(raw.id)].templateOwner;
    }
    if (mutation === "duplicate") heap[String(Math.max(...Object.keys(heap).map(Number)) + 1)] = structuredClone(template);
    expect(() => (publicDump ? restoreDump : restore)(JSON.parse(JSON.stringify(wire)), { source })).toThrow();
  }
);

it.each([false, true])("preserves template identity with its restored closure (rawOnly=%s)", async rawOnly => {
  const source = `{function tag(s){return ${rawOnly ? "s.raw" : "s"}}function call(){return tag\`x\`}const first=call();return {first,call}}`;
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  const wire = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { saved: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(wire)), { source });
  const binding = restored.currentScope.lookup("saved");
  if (!binding.found) throw new Error("Missing restored values");
  const result = await interpret(parseModule('{return saved.first===saved.call()}').body[0], {
    budget: restored.budget, bindings: { saved: binding.value }
  });
  expect(result).toMatchObject({ ok: true, returnValue: true });
});
