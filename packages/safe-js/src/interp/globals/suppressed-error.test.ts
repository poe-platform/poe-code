import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";
import { NativeSuppressedError } from "../../error/native-suppressed-error.js";
import { createErrorGlobals } from "./error.js";
import { Budget } from "../budget.js";

it.each(["new SuppressedError", "SuppressedError"])("constructs error payloads through %s", async construct => {
  expect(await run(`const first={id:1},second={id:2};const e=${construct}(first,second,'failed');return [e.error===first,e.suppressed===second,e.message,e.name,e instanceof Error,e instanceof SuppressedError,Error.isError(e)]`))
    .toMatchObject({ ok: true, returnValue: [true, true, "failed", "SuppressedError", true, true, true] });
});

it("defines non-enumerable writable configurable payloads even without arguments", async () => {
  expect(await run("const e=new SuppressedError();const a=Object.getOwnPropertyDescriptor(e,'error'),b=Object.getOwnPropertyDescriptor(e,'suppressed');return [a.value,b.value,a.enumerable,b.enumerable,a.writable,b.writable,a.configurable,b.configurable,Object.hasOwn(e,'message')]"))
    .toMatchObject({ ok: true, returnValue: [undefined, undefined, false, false, true, true, true, true, false] });
});

it("coerces only the message and ignores extra options", async () => {
  expect(await run("const events=[];const value={toString(){throw 'payload coercion'}};const message={toString(){events.push('message');return 'text'}};const options={get cause(){throw 'extra options'}};const e=new SuppressedError(value,value,message,options);return [e.message,e.error===value,e.suppressed===value,Object.hasOwn(e,'cause'),events]"))
    .toMatchObject({ ok: true, returnValue: ["text", true, true, false, ["message"]] });
});

it("supports subclasses and standard constructor/prototype metadata", async () => {
  expect(await run("class E extends SuppressedError{}const e=new E(1,2);return [e instanceof E,e.error,e.suppressed,SuppressedError.length,SuppressedError.name,Object.getPrototypeOf(SuppressedError)===Error,Object.getPrototypeOf(SuppressedError.prototype)===Error.prototype,Error.isError(SuppressedError.prototype)]"))
    .toMatchObject({ ok: true, returnValue: [true, 1, 2, 3, "SuppressedError", true, true, false] });
});

it("preserves payload aliases and brands through JSON snapshots", async () => {
  const source = "const value={id:7};const e=new SuppressedError(value,value,'text');return ()=>[e.error===e.suppressed,e.error.id,e instanceof SuppressedError,Error.isError(e)]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const snapshot = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { read: result.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source }).currentScope.lookup("read");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("missing reader");
  expect(await binding.value.call([])).toEqual([true, 7, true, true]);
});

it("exports standard error data to host callers", async () => {
  const result = await run("return new SuppressedError(1,2,'text')");
  if (!result.ok) throw result.error;
  expect(deepCopyFromSandbox(result.returnValue)).toMatchObject({ name: "SuppressedError", message: "text", error: 1, suppressed: 2 });
});

it("preserves host SuppressedError payloads and brands on import", async () => {
  expect(await run("return [e.error,e.suppressed,Error.isError(e)]", { bindings: { e: new NativeSuppressedError(1, 2) } }))
    .toMatchObject({ ok: true, returnValue: [1, 2, true] });
});

it("preserves cyclic host payloads", async () => {
  const e = new NativeSuppressedError();
  e.error = e;
  e.suppressed = e;
  expect(await run("return [e.error===e,e.suppressed===e]", { bindings: { e } }))
    .toMatchObject({ ok: true, returnValue: [true, true] });
});

it.each(["error", "suppressed"] as const)("does not import executable or accessor %s payloads", async key => {
  const e = new NativeSuppressedError();
  e[key] = () => "secret";
  await expect(run("return e", { bindings: { e } })).rejects.toThrow("Host error data");
  Object.defineProperty(e, key, { get() { throw new Error("must not read"); } });
  expect(await run(`return typeof e.${key}`, { bindings: { e } }))
    .toMatchObject({ ok: true, returnValue: "undefined" });
});

it("rejects symbol messages without coercing payloads", async () => {
  expect(await run("try{new SuppressedError(1,2,Symbol())}catch(e){return e instanceof TypeError}"))
    .toMatchObject({ ok: true, returnValue: true });
});

it("preserves legacy-mode error payloads during host data copying", async () => {
  const error = await createErrorGlobals({ budget: new Budget() }).SuppressedError.call([1, 2]);
  expect(deepCopyFromSandbox(error)).toMatchObject({ name: "SuppressedError", error: 1, suppressed: 2 });
});
