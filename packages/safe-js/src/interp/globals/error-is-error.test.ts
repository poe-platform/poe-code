import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../../run.js";
import { isSandboxClosure, type SandboxValue } from "../values.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";

it.each([
  ["Error.isError(new Error('x'))", true],
  ["Error.isError(new TypeError('x'))", true],
  ["Error.isError(new AggregateError([]))", true],
  ["Error.isError(Error.prototype)", false],
  ["Error.isError(Object.create(Error.prototype))", false],
  ["Error.isError({name:'Error',message:'x',[Symbol.toStringTag]:'Error'})", false],
  ["Error.isError(null)", false],
  ["Error.isError()", false],
  ["Error.isError(undefined)", false],
  ["Error.isError(7)", false],
  ["Error.isError(Symbol())", false]
] as const)("checks the error brand: %s", async (expression, expected) => {
  expect(await run(`return ${expression}`)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError"])("recognizes %s instances but not their prototypes", async name => {
  expect(await run(`return [Error.isError(new ${name}()),Error.isError(${name}.prototype)]`))
    .toMatchObject({ ok: true, returnValue: [true, false] });
});

it("does not read diagnostic properties or coerce ordinary objects", async () => {
  expect(await run("const value={get name(){throw 1},get message(){throw 2},get [Symbol.toStringTag](){throw 3}};return Error.isError(value)"))
    .toMatchObject({ ok: true, returnValue: false });
});

it.each([new Error("host"), runInNewContext("new TypeError('foreign')"), new DOMException("host", "AbortError")])("recognizes errors admitted through host bindings: %s", async error => {
  expect(await run("return Error.isError(error)", { bindings: { error } }))
    .toMatchObject({ ok: true, returnValue: true });
});

it("rejects host proxies without invoking their traps", async () => {
  const result = await run("return Error.isError");
  if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("missing method");
  const proxy = new Proxy(new Error("target"), {
    get() { throw new Error("must not read"); },
    getPrototypeOf() { throw new Error("must not inspect prototype"); }
  });
  expect(await result.returnValue.call([proxy as unknown as SandboxValue])).toBe(false);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  expect(await result.returnValue.call([revoked.proxy])).toBe(false);
});

it("restores error brands and escaped method aliases through JSON snapshots", async () => {
  const source = "const check=Error.isError;Error.isError=()=>false;const error=new TypeError('x');Object.setPrototypeOf(error,null);return ()=>[check(error),Error.isError(error)]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const snapshot = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { read: result.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source }).currentScope.lookup("read");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("missing reader");
  expect(await binding.value.call([])).toEqual([true, false]);
});

it("preserves the brand across subclassing and prototype replacement", async () => {
  expect(await run("class E extends Error{}const e=new E();Object.setPrototypeOf(e,null);return Error.isError(e)"))
    .toMatchObject({ ok: true, returnValue: true });
});

it("recognizes interpreter-generated errors", async () => {
  expect(await run("try{null.missing}catch(error){return Error.isError(error)}"))
    .toMatchObject({ ok: true, returnValue: true });
});

it("is callable with an unrelated receiver but is not a constructor", async () => {
  expect(await run("const branded=Error.isError.call(null,new Error());try{new Error.isError()}catch(error){return [branded,error instanceof TypeError]}"))
    .toMatchObject({ ok: true, returnValue: [true, true] });
});

it("exposes normal static method metadata and inherited aliases", async () => {
  expect(await run("const d=Object.getOwnPropertyDescriptor(Error,'isError');return [d.enumerable,d.writable,d.configurable,Error.isError.name,Error.isError.length,TypeError.isError===Error.isError]"))
    .toMatchObject({ ok: true, returnValue: [false, true, true, "isError", 1, true] });
});
