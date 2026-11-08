import {expect, it, vi} from "vitest";
import {SourceModuleGraph} from "./source-graph.js";
import {Budget} from "../interp/budget.js";
import {CompileScope} from "../interp/regex/compile-guard.js";
import {createBuiltinBindings} from "../interp/globals.js";
import {Scope} from "../interp/scope.js";
import {createModuleEnvironment} from "./registry.js";

async function fixture(sources: Record<string,string>, entry = "entry") {
  const budget = new Budget();
  const lease = budget.acquireCompileOwner();
  const compilation = new CompileScope(lease.owner);
  const scope = new Scope(createBuiltinBindings({budget,compileOwner:lease.owner}));
  const resolve = vi.fn((specifier: string) => sources[specifier] === undefined ? undefined : {id:specifier,source:sources[specifier]});
  const graph = new SourceModuleGraph({resolver:resolve,scope,budget,compilation,surfaceUnhandledThrows:true,
    modules:createModuleEnvironment(undefined,{budget,compileOwner:lease.owner})});
  try { return {namespace:await graph.import(entry,"<host>"),graph,resolve}; }
  finally { compilation.dispose(); lease.release(); }
}

it("links live imports and re-exports before evaluating", async () => {
  const {namespace} = await fixture({
    entry: "import {value, inc} from 'middle'; inc(); export const result=value; export * from 'middle'",
    middle: "export {value,inc} from 'dep'",
    dep: "export let value=1; export function inc(){value++}"
  });
  expect(namespace.result).toBe(2);
  expect(namespace.value).toBe(2);
});

it("links functions across cycles before evaluation", async () => {
  const {namespace} = await fixture({entry:"import {value} from 'dep'; export function f(){return 7}; export {value}",
    dep:"import {f} from 'entry'; export const value=f()"});
  expect(namespace.value).toBe(7);
});

it("detects ambiguous star exports while linking", async () => {
  await expect(fixture({entry:"import {x} from 'middle'",middle:"export * from 'a'; export * from 'b'",
    a:"export const x=1",b:"export const x=2"})).rejects.toThrow(SyntaxError);
});

it("omits ambiguous namespace exports but keeps identical resolutions", async () => {
  const {namespace} = await fixture({entry:"export * from 'a'; export * from 'b'; export * from 'c'",
    a:"export const x=1; export const y=3",b:"export const x=2; export {y} from 'a'",c:"export {y} from 'a'"});
  expect(Object.keys(namespace)).toEqual(["y"]);
  expect(namespace.y).toBe(3);
});

it("enforces the temporal dead zone across a cycle", async () => {
  await expect(fixture({entry:"import 'dep'; export let x=1",dep:"import {x} from 'entry'; x"}))
    .rejects.toMatchObject({name:"ReferenceError",message:"Cannot access 'x' before initialization."});
});

it("denies resolution without host permission", async () => {
  await expect(fixture({entry:"import 'node:fs'"})).rejects.toThrow("Source resolver denied 'node:fs'");
});

it("waits for top-level await before evaluating importers", async () => {
  const {namespace} = await fixture({entry:"import {x} from 'dep'; export const result=x",dep:"export const x=await Promise.resolve(7)"});
  expect(namespace.result).toBe(7);
});

it("preserves namespace identity across aliases and dynamic imports", async () => {
  const {namespace} = await fixture({entry:"import * as first from 'dep'; const second=await import('dep'); export const same=first===second",
    dep:"export let x=1"});
  expect(namespace.same).toBe(true);
});

it("resolves source imports asynchronously without blocking their importing statement", async () => {
  const {namespace} = await fixture({entry:"import {events} from 'shared'; export {events}; const pending=import('dep'); events.push('entry'); await pending;",
    shared:"export const events=[]", dep:"import {events} from 'shared'; events.push('dep')"});
  expect(namespace.events).toEqual(["entry","dep"]);
});

it("keeps namespace inspection from initializing a cyclic export", async () => {
  const {namespace} = await fixture({entry:"import {names} from 'dep'; export let x=1; export {names}",
    dep:"import * as ns from 'entry'; export const names=Reflect.ownKeys(ns).map(String)"});
  expect(namespace.names).toEqual(["names","x","Symbol(Symbol.toStringTag)"]);
});

it("distinguishes the named export '*' from a namespace import",async()=>{
  const {namespace}=await fixture({entry:"import {'*' as value} from 'dep'; export {value}",dep:"const x=7;export {x as '*'}"});
  expect(namespace.value).toBe(7);
});

it("does not make repeated namespace re-exports ambiguous",async()=>{
  const {namespace}=await fixture({entry:"export * from 'a';export * from 'b'",a:"export * as ns from 'dep'",b:"export * as ns from 'dep'",dep:"export const x=7"});
  expect(Object.keys(namespace)).toEqual(["ns"]);
  expect((namespace.ns as Record<string,unknown>).x).toBe(7);
});

it("tests namespace membership without reading an uninitialized binding",async()=>{
  const {namespace}=await fixture({entry:"import * as ns from 'entry';export const present=('x' in ns)&&Reflect.has(ns,'x');export let x=1"});
  expect(namespace.present).toBe(true);
});

it("reports an unresolvable source-module reference as ReferenceError",async()=>{
  await expect(fixture({entry:"export default unresolvable"})).rejects.toMatchObject({name:"ReferenceError"});
});

it("reads the receiver's namespace descriptor before rejecting a super assignment",async()=>{
  const {namespace}=await fixture({entry:`import * as ns from 'entry';
    class A{constructor(){return ns}} class B extends A{constructor(){super();super.x=1}}
    let error;try{new B()}catch(e){error=e.name}export {error};export let x=2;`});
  expect(namespace.error).toBe("ReferenceError");
});

it("evaluates synchronous dependencies in depth-first source order",async()=>{
  const {namespace}=await fixture({entry:"import {events} from 'state';import 'a';import 'b';export {events}",
    state:"export const events=[]",a:"import {events} from 'state';import 'c';events.push('a')",b:"import {events} from 'state';events.push('b')",c:"import {events} from 'state';events.push('c')"});
  expect(namespace.events).toEqual(["c","a","b"]);
});

it("waits for the entire async cycle before evaluating an outside importer",async()=>{
  const {namespace}=await fixture({entry:"import 'root';import 'user';export {events} from 'state'",
    state:"export const events=[]",root:"import 'leaf';import {events} from 'state';events.push('root start');await 0;events.push('root end')",
    leaf:"import 'root';import {events} from 'state';events.push('leaf');await 0",user:"import 'leaf';import {events} from 'state';events.push('user')"});
  expect(namespace.events).toEqual(["leaf","root start","root end","user"]);
});

it("rejects unsupported static attributes with a linking SyntaxError",async()=>{
  await expect(fixture({entry:"import 'dep' with {type:'json'}",dep:"export const x=1"})).rejects.toThrow(SyntaxError);
});
