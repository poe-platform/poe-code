import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../../run.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";
import { isSandboxClosure } from "../values.js";

it.each([
  "return [String.prototype.trimLeft===String.prototype.trimStart,String.prototype.trimRight===String.prototype.trimEnd]",
  "return ['trimLeft','trimRight'].map(key=>{const d=Object.getOwnPropertyDescriptor(String.prototype,key);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]})",
  "return ['trimLeft','trimRight'].map(key=>'\\uFEFF\\t text \\n'[key]())",
  "return ['trimLeft','trimRight'].map(key=>String.prototype[key].call({toString(){return ' text '}}))",
  "return ['trimLeft','trimRight'].map(key=>{try{String.prototype[key].call(null)}catch(e){return e.name}})",
  "return ['trimLeft','trimRight'].map(key=>{try{String.prototype[key].call(Symbol())}catch(e){return e.name}})",
  "const left=String.prototype.trimLeft;String.prototype.trimStart=()=> 'replacement';return [left.call(' text '),' text '.trimLeft(),' text '.trimStart()]",
  "delete String.prototype.trimLeft;return [typeof ''.trimLeft,' text '.trimStart()]"
])("matches native trim aliases: %s", async source => {
  const expected = runInNewContext(`(function(){'use strict';${source}})()`);
  const result = await run(`if(typeof String.prototype.trimLeft!=='function')throw new Error('Missing trim aliases');${source}`);
  if (!result.ok) throw result.error;
  expect(result.returnValue).toEqual(expected);
});

it("preserves alias identity and shared function mutations through a snapshot", async () => {
  const source = "const left=String.prototype.trimLeft;left.marker=7;return ()=>[left===String.prototype.trimStart,left===String.prototype.trimLeft,String.prototype.trimStart.marker,left.call(' text ')]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const binding = restored.currentScope.lookup("reader");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
  expect(await binding.value.call([])).toEqual([true, true, 7, "text "]);
});
