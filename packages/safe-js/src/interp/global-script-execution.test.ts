import { expect, it } from "vitest";
import { constants, createContext, runInContext, Script } from "node:vm";
import { parseEvalScript } from "../parse/parser.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { interpret, Scope } from "./interpreter.js";
import { getRealmGlobalObject } from "./intrinsics.js";
import { releaseObjectPrototype } from "./object-model.js";
import { isSandboxClosure, isSandboxPromise } from "./values.js";
import { SandboxJobQueue } from "./jobs.js";

function realm(signal?: AbortSignal) {
  const budget = new Budget();
  const bindings = createBuiltinBindings({ budget });
  const operation = budget.acquireCompileOwner(false);
  const jobs = new SandboxJobQueue();
  const scope = new Scope(bindings).child({}, { globalEnvironment: true });
  scope.declare("this", "const", getRealmGlobalObject(budget));
  return { budget, scope, release: operation.release, async evaluate(source: string) {
    const parsed = parseEvalScript(source, {}, operation.owner);
    return interpret({ type: "BlockStatement", body: parsed.node.body, span: parsed.node.span }, {
      budget, scope, jobs, signal, compileOwner: operation.owner,
      useScopeDirectly: true, surfaceUnhandledThrows: true, script: { strict: parsed.strict }
    });
  } };
}

it.each([false, true])("creates nondeletable global Script variables and functions (strict: %s)", async strict => {
  const current = realm();
  try {
    const source = `${strict ? '"use strict";' : ""}var probe=1;function read(){return probe}
      [read(),Object.getOwnPropertyDescriptor(globalThis,"probe").configurable,
      Object.getOwnPropertyDescriptor(globalThis,"read").configurable]`;
    expect(await current.evaluate(source)).toMatchObject({ ok: true, returnValue: [1, false, false] });
  } finally { releaseObjectPrototype(current.budget); current.release(); }
});

it.each([
  { setup: "let locked=1", source: "var fresh;var locked", error: "SyntaxError" },
  { setup: "var locked=1", source: "let fresh;let locked", error: "SyntaxError" },
  { setup: "const locked=1", source: "var fresh;function locked(){}", error: "SyntaxError" },
  { setup: 'Object.defineProperty(globalThis,"locked",{value:1})', source: "let fresh;let locked", error: "SyntaxError" },
  { setup: 'Object.defineProperty(globalThis,"locked",{value:1})', source: "var fresh;function locked(){}", error: "TypeError", nativeError: "SyntaxError" },
  { setup: "Object.preventExtensions(globalThis)", source: "var fresh", error: "TypeError" }
])("rejects Script declarations before creating earlier bindings: $source after $setup", async ({ setup, source, error, nativeError }) => {
  const native = createContext(constants.DONT_CONTEXTIFY);
  runInContext(setup, native);
  // Node 22 reports SyntaxError for one CanDeclareGlobalFunction rejection;
  // GlobalDeclarationInstantiation requires TypeError in that case.
  expect(() => runInContext(source, native)).toThrow(expect.objectContaining({ name: nativeError ?? error }));
  expect(runInContext('typeof fresh', native)).toBe("undefined");
  const current = realm();
  try {
    await current.evaluate(setup);
    const outcome = await current.evaluate(source).then(() => ({ ok: true }), reason => ({ ok: false, name: reason.name }));
    expect(outcome).toEqual({ ok: false, name: error });
    expect(await current.evaluate('typeof fresh')).toMatchObject({ ok: true, returnValue: "undefined" });
    expect(Object.hasOwn(getRealmGlobalObject(current.budget), "fresh")).toBe(false);
  } finally { releaseObjectPrototype(current.budget); current.release(); }
});

it.each([
  ['"use strict";this===globalThis', true],
  ['fresh=7;globalThis.fresh', 7],
  ['"use strict";try{fresh=7}catch(error){error.name}', "ReferenceError"],
  ['1;var probe=2;', 1],
  ['1;{2;var probe=3;}', 2]
] as const)("preserves Script completion and execution mode: %s", async (source, expected) => {
  const current = realm();
  try { expect(await current.evaluate(source)).toMatchObject({ ok: true, returnValue: expected }); }
  finally { releaseObjectPrototype(current.budget); current.release(); }
});

it("retains global lexical declarations across scripts without exposing them as properties", async () => {
  const current = realm();
  try {
    expect(await current.evaluate("let retained=7")).toMatchObject({ ok: true });
    expect(await current.evaluate('[retained,Object.hasOwn(globalThis,"retained")]'))
      .toMatchObject({ ok: true, returnValue: [7, false] });
  } finally { releaseObjectPrototype(current.budget); current.release(); }
});

it.each([
  '{function probe(){return 7}} [typeof probe,probe(),Object.getOwnPropertyDescriptor(globalThis,"probe").configurable]',
  'if(false){function probe(){}} [typeof probe,Object.hasOwn(globalThis,"probe"),Object.getOwnPropertyDescriptor(globalThis,"probe").configurable]',
  '"use strict";{function probe(){}} typeof probe',
  'let probe=9;{function probe(){return 7}} probe',
  'Object.preventExtensions(globalThis);{function probe(){return 7}} typeof probe',
  'function probe(){return 1}function probe(){return 2} [probe(),Object.getOwnPropertyDescriptor(globalThis,"probe").configurable]'
])("matches native Script legacy and repeated functions: %s", async source => {
  const expected = runInContext(source, createContext(constants.DONT_CONTEXTIFY));
  const current = realm();
  try { expect(await current.evaluate(source)).toMatchObject({ ok: true, returnValue: expected }); }
  finally { releaseObjectPrototype(current.budget); current.release(); }
});

it("keeps block functions lexical when a previous Script made the global nonextensible", async () => {
  const source = "{function probe(){return 7}} typeof probe";
  const native = createContext(constants.DONT_CONTEXTIFY);
  runInContext("Object.preventExtensions(globalThis)", native);
  // Node 22 throws here. GlobalDeclarationInstantiation's legacy branch
  // instead skips the extra var when CanDeclareGlobalVar is false.
  expect(() => runInContext(source, native)).toThrow(expect.objectContaining({ name: "TypeError" }));
  const current = realm();
  try {
    await current.evaluate("Object.preventExtensions(globalThis)");
    expect(await current.evaluate(source)).toMatchObject({ ok: true, returnValue: "undefined" });
  } finally { releaseObjectPrototype(current.budget); current.release(); }
});

it("keeps earlier functions attached to the shared lexical environment", async () => {
  const current = realm();
  try {
    await current.evaluate("let value=7;function read(){return value}");
    expect(await current.evaluate("value++;read()"))
      .toMatchObject({ ok: true, returnValue: 8 });
  } finally { releaseObjectPrototype(current.budget); current.release(); }
});

it("preserves the owning realm when another Script realm calls a retained function", async () => {
  const owner = realm();
  const caller = realm();
  try {
    const result = await owner.evaluate('globalThis.marker="owner";function inspect(){return [globalThis.marker,Object.getPrototypeOf({})===Object.prototype]} inspect');
    if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("Missing retained function");
    caller.scope.declare("foreign", "const", result.returnValue);
    await owner.evaluate('globalThis.marker="updated"');
    expect(await caller.evaluate('globalThis.marker="caller";[foreign(),globalThis.marker]'))
      .toMatchObject({ ok: true, returnValue: [["updated", true], "caller"] });
  } finally { releaseObjectPrototype(owner.budget); releaseObjectPrototype(caller.budget); owner.release(); caller.release(); }
});

it("drains ready Promise reactions at the Script job boundary", async () => {
  const current = realm();
  try {
    expect(await current.evaluate("let events=[];Promise.resolve().then(()=>events.push(1));events.push(0);events"))
      .toMatchObject({ ok: true, returnValue: [0, 1] });
  } finally { releaseObjectPrototype(current.budget); current.release(); }
});

it("settles a pending async function from a later Script", async () => {
  const current = realm();
  try {
    await current.evaluate("const deferred=Promise.withResolvers();async function read(){return await deferred.promise}");
    const result = await current.evaluate("read()");
    if (!result.ok || !isSandboxPromise(result.returnValue)) throw new Error("Missing pending Promise");
    await current.evaluate("deferred.resolve(7)");
    await expect(result.returnValue.promise).resolves.toBe(7);
  } finally { releaseObjectPrototype(current.budget); current.release(); }
});

it("unwinds pending Script work and releases execution ownership on cancellation", async () => {
  const controller = new AbortController();
  const current = realm(controller.signal);
  try {
    const result = await current.evaluate("globalThis.cleaned=false;async function wait(){try{await new Promise(()=>{})}finally{globalThis.cleaned=true}} wait()");
    if (!result.ok || !isSandboxPromise(result.returnValue)) throw new Error("Missing pending Promise");
    const settled = result.returnValue.promise.then(
      () => ({ fulfilled: true }),
      error => ({ fulfilled: false, message: error.message })
    );
    controller.abort(new Error("Script stopped"));
    expect(await settled).toEqual({ fulfilled: false, message: "Script stopped" });
    expect(getRealmGlobalObject(current.budget).cleaned).toBe(true);
    current.release();
    const next = current.budget.acquireCompileOwner();
    next.release();
  } finally { releaseObjectPrototype(current.budget); current.release(); }
});

it.each([
  "globalThis.touched=true;return 1",
  "globalThis.touched=true;await 1",
  "globalThis.touched=true;export const value=1",
  "globalThis.touched=true;import.meta",
  "globalThis.touched=true;new.target",
  "globalThis.touched=true;let duplicate;var duplicate",
  '"use strict";globalThis.touched=true;with({}){}'
])("rejects invalid Script grammar before any execution: %s", async source => {
  expect(() => new Script(source)).toThrow(SyntaxError);
  const current = realm();
  try {
    await expect(current.evaluate(source)).rejects.toBeInstanceOf(SyntaxError);
    expect(Object.hasOwn(getRealmGlobalObject(current.budget), "touched")).toBe(false);
  } finally { releaseObjectPrototype(current.budget); current.release(); }
});

it("preserves execution before a runtime error, unlike a parse error", async () => {
  const current = realm();
  try {
    await expect(current.evaluate('globalThis.touched=true;throw new TypeError("runtime")'))
      .rejects.toMatchObject({ name: "TypeError", message: "runtime" });
    expect(getRealmGlobalObject(current.budget).touched).toBe(true);
    expect(await current.evaluate("touched")).toMatchObject({ ok: true, returnValue: true });
  } finally { releaseObjectPrototype(current.budget); current.release(); }
});

it.each([
  { setup: 'let first=1;throw new Error("stop");let later=2', throws: true,
    source: '[first,(()=>{try{return later}catch(e){return e.name}})()]' },
  { setup: 'Object.defineProperty(globalThis,"probe",{get(){return 7},configurable:true})',
    source: 'var probe;[probe,typeof Object.getOwnPropertyDescriptor(globalThis,"probe").get]' },
  { setup: 'Object.defineProperty(globalThis,"probe",{get(){return 7},configurable:true})',
    source: 'function probe(){return 8};[probe(),Object.getOwnPropertyDescriptor(globalThis,"probe").configurable]' },
  { setup: 'Object.setPrototypeOf(globalThis,{probe:7})',
    source: 'var probe;[probe,Object.hasOwn(globalThis,"probe")]' },
  { setup: 'globalThis.probe=7', source: 'let probe=8;[probe,globalThis.probe]' }
])("preserves global declaration initialization after $setup", async ({ setup, source, throws }) => {
  const native = createContext(constants.DONT_CONTEXTIFY);
  if (throws) expect(() => runInContext(setup, native)).toThrow("stop");
  else runInContext(setup, native);
  const expected = runInContext(source, native);
  const current = realm();
  try {
    if (throws) await expect(current.evaluate(setup)).rejects.toMatchObject({ message: "stop" });
    else await current.evaluate(setup);
    expect(await current.evaluate(source)).toMatchObject({ ok: true, returnValue: expected });
  } finally { releaseObjectPrototype(current.budget); current.release(); }
});
