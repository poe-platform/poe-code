import { runInNewContext } from "node:vm";
import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { serialize, type RuntimeSnapshotValue, type SerializedSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { Budget } from "../interp/budget.js";
import { isSandboxClosure } from "../interp/values.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";

it("rejects fields substituted into private method blueprints", async () => {
  const source = "class C{#m(){return 9}read(){return this.#m()}}return ()=>new C().read()";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  assert(snapshot.heap !== undefined);
  const constructor = Object.values(snapshot.heap).find(node => node.kind === "guest-class");
  assert(constructor?.kind === "guest-class" && constructor.privateMethods !== undefined);
  const method = constructor.privateMethods[0];
  assert(method.kind === "method");
  constructor.privateMethods[0] = {kind: "field", name: method.name, value: 7};
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()})).toThrow();
});

it("rejects redirected private destructuring continuations",async()=>{
  const source="class C{#x=0;#y=0;*read(){[this.#x=yield 1]=[undefined];return this.#x}}const g=new C().read();g.next();return ()=>g.next(7)";
  const result=await run(source);
  assert(result.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  assert(snapshot.heap !== undefined);
  const generator=Object.values(snapshot.heap).find(node=>node.kind === "guest-generator");
  assert(generator?.kind === "guest-generator");
  const continuation=Object.values(generator.expressionStates ?? {}).find(node=>node.kind === "array-pattern");
  assert(continuation?.kind === "array-pattern");
  continuation.privateName="y";
  expect(()=>restore(JSON.parse(JSON.stringify(snapshot)),{source,budget:new Budget()})).toThrow();
});

it.each<Record<string, SerializedSnapshotValue>>([
  {description:"other"}, {description:7}, {description:"x",extra:true}
])("rejects malformed private-name identity records: %j",async entries=>{
  const source="class C{static #x=3;static read(){return this.#x}}return ()=>C.read()";
  const result=await run(source);
  assert(result.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  assert(snapshot.heap !== undefined);
  const frame=Object.values(snapshot.heap).find(node=>node.kind === "scope-frame" && node.privateNames !== undefined);
  assert(frame?.kind === "scope-frame" && frame.privateNames !== undefined);
  const identity=frame.privateNames[0][1];
  assert(identity !== null && typeof identity === "object" && "kind" in identity && identity.kind === "ref");
  snapshot.heap[String(identity.id)]={kind:"object",entries};
  expect(()=>restore(JSON.parse(JSON.stringify(snapshot)),{source,budget:new Budget()})).toThrow();
});

it.each([
  ["const p=Number.prototype;return ()=>p===Number.prototype", true],
  ["const p=String.prototype;return ()=>p===String.prototype", true],
  ["const p=Boolean.prototype;return ()=>p===Boolean.prototype", true],
  ["class C extends DataView{#x=7;read(){return [this.#x,this.byteLength]}}const c=new C(new ArrayBuffer(2));return ()=>c.read()", [7,2]],
  ["class Base{constructor(value){return value}}class C extends Base{#x=7;static read(o){return o.#x}}function* values(){yield 2}const g=values();new C(g);return ()=>[C.read(g),g.next().value]", [7,2]],
  ["class Base{constructor(value){return value}}class C extends Base{#x=7;static read(o){return o.#x}}const it=[2].values();new C(it);return ()=>[C.read(it),it.next().value]", [7,2]],
  ["class C extends Uint8Array{#x=7;read(){return [this.#x,this[0]]}}const c=new C([2]);return ()=>c.read()", [7,2]],
  ["class C extends ArrayBuffer{#x=7;read(){return [this.#x,this.byteLength]}}const c=new C(2);return ()=>c.read()", [7,2]],
  ["class C extends RegExp{#x=7;read(){return [this.#x,this.test('a')]}}const c=new C('a');return ()=>c.read()", [7,true]],
  ["class C extends Map{#x=7;read(){return [this.#x,this.get('a')]}}const c=new C([['a',2]]);return ()=>c.read()", [7,2]],
  ["class C extends Set{#x=7;read(){return [this.#x,this.has(2)]}}const c=new C([2]);return ()=>c.read()", [7,true]],
  ["class C extends Number{#x=7;read(){return [this.#x,this.valueOf()]}}const c=new C(2);return ()=>c.read()", [7,2]],
  ["class C extends Date{#x=7;read(){return [this.#x,this.getTime()]}}const c=new C(2);return ()=>c.read()", [7,2]],
  ["class C{#x=0;*read(){[this.#x=yield 1]=[undefined];return this.#x}}const g=new C().read();g.next();return ()=>g.next(7)", {value:7,done:true}],
  ["class C{#x=0;*read(){({x:this.#x=yield 1}={});return this.#x}}const g=new C().read();g.next();return ()=>g.next(8)", {value:8,done:true}],
  ["class C{#x=1;*read(){this.#x+=yield 1;return this.#x}}const g=new C().read();g.next();return ()=>g.next(3)", {value:4,done:true}],
  ["class C{static #x=3;static read(){return this.#x++}}C.read();return ()=>C.read()", 4],
  ["class C{#x=3;read(){return this.#x++}}const c=new C();c.read();return ()=>c.read()", 4],
  ["class C{#m(){return 9}read(){return this.#m()}}const c=new C();return ()=>[c.read(),new C().read()]", [9,9]],
  ["class C{#x=2;get #v(){return this.#x}set #v(v){this.#x=v}read(){this.#v++;return this.#v}}const c=new C();return ()=>[c.read(),new C().read()]", [3,3]]
] as const)("executes directly restored private state: %s", async (source, expected) => {
  const result=await run(source);
  assert(result.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup("read");
  assert(binding.found && isSandboxClosure(binding.value));
  expect(await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined)).toEqual(expected);
});

it.each([
  "class C{#x=1;read(){return this.#x++}}const c=new C();c.read();await 0;return c.read()",
  "class Base{constructor(value){return value}}class C extends Base{#x=7;static read(o){return o.#x}}const p=Promise.resolve(2);new C(p);const value=await p;await 0;return [C.read(p),value]",
  "class C{static #x=3;static read(){return this.#x++}}C.read();await 0;return C.read()",
  "class C{#x=7;closure(){return ()=>this.#x}}const read=new C().closure();await 0;return read()",
  "class C{#m(){return 9}read(){return this.#m()}}const c=new C();await 0;return [c.read(),new C().read()]"
])("replays private elements across await: %s",async source=>{
  const expected=await runInNewContext("(async()=>{"+source+"})()");
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
  const snapshot=JSON.parse(await dump(result));
  const replay=await run(source,{snapshot});
  assert(replay.ok);
  expect(replay.returnValue).toEqual(expected);
});

it("restores a pending promise and its resolver in private slots", async () => {
  const source="class C{#c=Promise.withResolvers();async read(){this.#c.resolve(7);return await this.#c.promise}}const c=new C();return ()=>c.read()";
  const result=await run(source);
  assert(result.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup("read");
  assert(binding.found && isSandboxClosure(binding.value));
  const value=await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined);
  expect(await awaitSandboxValue(value,undefined,budget)).toBe(7);
});
