import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../core.js";
import { interpret } from "./interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { dump } from "../dump.js";
import { restore as restoreDump } from "../restore.js";

it.each([
  'function tag(s){return [Object.isFrozen(s),Object.isFrozen(s.raw)]}return tag`a${1}b`',
  'function tag(s){return [Object.getOwnPropertyDescriptor(s,"0"),Object.getOwnPropertyDescriptor(s,"length"),Object.getOwnPropertyDescriptor(s.raw,"0")]}return tag`a`',
  'function tag(s){try{s[0]="changed"}catch(e){return [e.name,s[0]]}}return tag`a`',
  'function tag(s){try{s.raw[0]="changed"}catch(e){return [e.name,s.raw[0]]}}return tag`a`',
  'function tag(s){try{s.push("changed")}catch(e){return [e.name,s.length]}}return tag`a`',
  'function tag(s){try{delete s[0]}catch(e){return [e.name,s[0]]}}return tag`a`',
  'function tag(s){return [Object.isFrozen(s),s[0],s.raw[0]]}return tag`\\u{invalid}`'
])("matches native frozen template arrays: %s", async source => {
  const native = runInNewContext(`(()=>{'use strict';${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: native });
});

it("preserves frozen cooked and raw arrays through low-level restoration", async () => {
  const source = '{function tag(s){return s}return tag`a${1}b`}';
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { template: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
  const binding = restored.currentScope.lookup("template");
  if (!binding.found) throw new Error("Missing restored template");
  expect(Object.isFrozen(binding.value)).toBe(true);
  const raw = Object.getOwnPropertyDescriptor(binding.value, "raw");
  expect(raw).toMatchObject({ configurable: false, enumerable: false, writable: false, value: ["a", "b"] });
  expect(Object.isFrozen(raw?.value)).toBe(true);
});

it("preserves template integrity through public dump and replay", async () => {
  const source = 'function tag(s){return s}const template=tag`a${1}b`;await 0;return [Object.isFrozen(template),Object.isFrozen(template.raw),template.raw]';
  const execution = run(source);
  const wire = JSON.parse(await dump(execution));
  expect(Object.values(wire.heap as Record<string, { kind: string }>).some(node => node.kind === "guest-array")).toBe(true);
  expect(await execution).toMatchObject({ ok: true, returnValue: [true, true, ["a", "b"]] });
  expect(await run(source, { snapshot: restoreDump(wire, { source }) }))
    .toMatchObject({ ok: true, returnValue: [true, true, ["a", "b"]] });
});
