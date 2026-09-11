import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../../run.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";
import { isSandboxClosure } from "../values.js";

const names = ["toExponential", "toFixed", "toPrecision", "toString", "toLocaleString"];

it.each(names)("matches native function metadata for Number.prototype.%s", async name => {
  const source = `const f=Number.prototype[${JSON.stringify(name)}];return [f.name,f.length,...['name','length'].map(key=>{const d=Object.getOwnPropertyDescriptor(f,key);return [d.writable,d.enumerable,d.configurable]})]`;
  const expected = runInNewContext(`(function(){${source}})()`);
  const result = await run(source);
  if (!result.ok) throw result.error;
  expect(result.returnValue).toEqual(expected);
});

it.each(names)("restores mutable properties on Number.prototype.%s", async name => {
  const source = `const f=Number.prototype[${JSON.stringify(name)}];f.marker={value:7};f.self=f;return ()=>[f===Number.prototype[${JSON.stringify(name)}],f.self===f,f.marker.value]`;
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const binding = restored.currentScope.lookup("reader");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
  expect(await binding.value.call([])).toEqual([true, true, 7]);
});
