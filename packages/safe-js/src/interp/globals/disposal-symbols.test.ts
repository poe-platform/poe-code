import { expect, it } from "vitest";
import { run } from "../../run.js";
import { decodeReplayData, encodeReplayData } from "../../snapshot/replay-data.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";
import { isSandboxClosure } from "../values.js";

it.each(["dispose", "asyncDispose"] as const)("exposes immutable Symbol.%s with host identity", async name => {
  const result = await run(`return Symbol.${name}`);
  expect(result).toMatchObject({ ok: true });
  expect(result.returnValue).toBe(Symbol[name]);
  expect(await run(`const d=Object.getOwnPropertyDescriptor(Symbol,'${name}');return [typeof d.value,d.writable,d.enumerable,d.configurable,Symbol.keyFor(d.value)]`))
    .toMatchObject({ ok: true, returnValue: ["symbol", false, false, false, undefined] });
});

it.each(["dispose", "asyncDispose"] as const)("preserves Symbol.%s identity through JSON replay data", name => {
  const key = Symbol[name];
  const value = { key, [key]: 7 };
  const encoded = encodeReplayData(value);
  expect(encoded.nodes).toContainEqual({ kind: "symbol", wellKnown: name });
  const restored = decodeReplayData(JSON.parse(JSON.stringify(encoded))) as typeof value;
  expect(restored.key).toBe(key);
  expect(restored[key]).toBe(7);
});

it("keeps disposal symbols distinct from each other and registry symbols", async () => {
  expect(await run("return [Symbol.dispose!==Symbol.asyncDispose,Symbol.dispose!==Symbol.for('nodejs.dispose'),Symbol.asyncDispose!==Symbol.for('nodejs.asyncDispose')]"))
    .toMatchObject({ ok: true, returnValue: [true, true, true] });
});

it.each(["dispose", "asyncDispose"])("restores escaped Symbol.%s keys through JSON snapshots", async name => {
  const source = `const key=Symbol.${name};const value={[key]:7};return ()=>[key===Symbol.${name},value[Symbol.${name}]]`;
  const result = await run(source);
  if (!result.ok) throw result.error;
  const snapshot = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { read: result.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source }).currentScope.lookup("read");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("missing reader");
  expect(await binding.value.call([])).toEqual([true, 7]);
});
