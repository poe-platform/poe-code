import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { declareHostOperation } from "./host-bridge.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore as restoreGraph } from "../snapshot/restore.js";
import { getSandboxDataProperty } from "./object-model.js";
import { isSandboxClosure } from "./values.js";
import { Budget } from "./budget.js";
import { validateGuestHeapNode } from "../snapshot/guest-heap-validation.js";
import { MAX_DATA_DEPTH } from "../graph-depth.js";

it("bounds untrusted bound-target chain traversal", async () => {
  const source="return Math.abs.bind(null)";
  const original=await run(source);
  const saved=JSON.parse(JSON.stringify(serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{bound:original.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}})));
  const entry=Object.values(saved.heap).find((value)=> (value as {kind:string}).kind==="bound-function") as Record<string,unknown>;
  let target=entry.target;
  let id=Math.max(...Object.keys(saved.heap).map(Number))+1;
  let node=entry;
  for(let index=0;index<=MAX_DATA_DEPTH;index++){
    node={...entry,target};
    saved.heap[String(id)]=node;
    target={kind:"ref",id:id++};
  }
  expect(()=>validateGuestHeapNode(node,saved.heap)).toThrow("dataDepth");
});

it.each([
  { source: "function f(a,b){return this.base+a+b}return f.bind({base:2},3)", args: [4], expected: 9 },
  { source: "const receiver={base:2};function f(a){return [this.self===bound,a.self===bound]}const bound=f.bind(receiver,receiver);receiver.self=bound;return bound", args: [], expected: [true,true] },
  { source: "function f(a,b){return this.base+a+b}const first=f.bind({base:2},3);return first.bind({base:100},4)", args: [], expected: 9 },
  { source: "return Math.max.bind(null,2)", args: [7], expected: 7 },
  { source: "function f(){return bound.extra.self===bound}const bound=f.bind(null);bound.extra={self:bound};Object.freeze(bound);return bound", args: [], expected: true },
  { source: "function F(a,b){this.sum=a+b;this.target=new.target===F}const bound=F.bind({ignored:true},3);return ()=>{const instance=new bound(4);return [instance.sum,instance.target,instance instanceof F,instance instanceof bound,Object.hasOwn(bound,'prototype')]}", args: [], expected: [7,true,true,true,false] },
  { source: "function F(a,b){this.sum=a+b;this.target=new.target===F}const first=F.bind(null,3);const bound=first.bind(null,4);return ()=>{const instance=new bound();return [instance.sum,instance.target,instance instanceof first]}", args: [], expected: [7,true,true] },
  { source: "const receiver={};function f(){return this.self===outer}const first=f.bind(receiver);const outer=first.bind(null);receiver.self=outer;return outer", args: [], expected: true },
  { source: "const object={};const bound=(function(){return this.base}).bind({base:7});Object.defineProperty(object,'value',{get:bound});return ()=>object.value", args: [], expected: 7 },
  { source: "let reads=0;function f(){return reads}Object.defineProperty(f,'name',{get(){reads++;return 'renamed'}});return f.bind(null)", args: [], expected: 1 },
  { source: "function f(){}Object.defineProperty(f,'length',{value:Infinity});const bound=f.bind(null,1);return ()=>bound.length", args: [], expected: Infinity },
  { source: "function* f(value){yield value}const bound=f.bind(null,7);return ()=>{const cursor=bound();return [cursor.next().value,Object.getPrototypeOf(cursor)===f.prototype]}", args: [], expected: [7,true] }
])("round trips bound function state: $source", async ({source,args,expected}) => {
  const original=await run(source);
  expect(original.ok).toBe(true);
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{bound:original.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored=restoreGraph(JSON.parse(JSON.stringify(saved)),{source});
  const binding=restored.currentScope.lookup("bound");
  if(!binding.found||!isSandboxClosure(binding.value))throw new Error("Missing bound function");
  expect(await binding.value.call(args)).toEqual(expected);
  const again=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{bound:binding.value as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const second=restoreGraph(JSON.parse(JSON.stringify(again)),{source}).currentScope.lookup("bound");
  if(!second.found||!isSandboxClosure(second.value))throw new Error("Missing resnapshotted function");
  expect(await second.value.call(args)).toEqual(expected);
});

it("charges restored bound arguments to the data budget", async () => {
  const source="function f(value){return value}return f.bind(null,'x'.repeat(10000))";
  const original=await run(source);
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{bound:original.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  expect(()=>restoreGraph(JSON.parse(JSON.stringify(saved)),{source,budget:new Budget({dataSize:1000})})).toThrow("exceeds aggregate data limit 1000");
});

it.each(["cycle", "object-target", "scope-argument", "unknown-field", "bad-length", "argument-limit"])(
  "rejects malformed bound state: %s", async mutation => {
    const source="function f(v){return v}return f.bind(null,1)";
    const original=await run(source);
    const saved=JSON.parse(JSON.stringify(serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{bound:original.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}})));
    const entries=Object.entries(saved.heap) as Array<[string,Record<string,unknown>]>;
    const [id,bound]=entries.find(([,entry])=>entry.kind==="bound-function")!;
    if(mutation==="cycle")bound.target={kind:"ref",id:Number(id)};
    if(mutation==="object-target")bound.target={kind:"ref",id:Number(entries.find(([,entry])=>entry.kind==="scope-frame")![0])};
    if(mutation==="scope-argument")bound.args=[{kind:"ref",id:Number(entries.find(([,entry])=>entry.kind==="scope-frame")![0])}];
    if(mutation==="unknown-field")bound.extra=true;
    if(mutation==="bad-length")bound.length=-1;
    if(mutation==="argument-limit")bound.args=[1,2,3,4];
    expect(()=>restoreGraph(saved,{source,...(mutation==="argument-limit"?{budget:new Budget({arrayLength:3})}:{})})).toThrow();
  }
);

it.each(["length", "name"])("preserves the selected prototype after a %s getter and pending effect", async key => {
  const source = `function f(v){return this.base+v}const bind=f.bind;Object.setPrototypeOf(f,{tag:'old'});
    Object.defineProperty(f,'${key}',{get(){Object.setPrototypeOf(f,null);return ${key === "length" ? "2" : "'renamed'"}}});
    const bound=bind.call(f,{base:2},3);await pause();return [bound.tag,bound.name,bound.length,bound()]`;
  let release!: () => void;
  let signalEntered!: () => void;
  const gate = new Promise<void>(resolve => {release=resolve;});
  const entered = new Promise<void>(resolve => {signalEntered=resolve;});
  const execution = run(source,{bindings:{pause:declareHostOperation(async()=>{signalEntered();await gate;},"re-issue")}});
  void execution.catch(()=>undefined);
  let saved: string;
  try {
    await Promise.race([entered,execution]);
    saved=await dump(execution,{mode:"replay"});
  } finally {release();}
  const expected = await runInNewContext(`(async function(){const pause=()=>{};${source}})()`);
  expect(await execution).toMatchObject({ok:true,returnValue:expected});
  expect(await run(source,{snapshot:restore(JSON.parse(saved),{source}),bindings:{pause:declareHostOperation(async()=>{},"re-issue")}}))
    .toMatchObject({ok:true,returnValue:expected});
});

it("restores the selected prototype and bound call without reexecuting metadata getters", async () => {
  const source = "function f(v){return this.base+v}const bind=f.bind;Object.setPrototypeOf(f,{tag:'old'});Object.defineProperty(f,'name',{get(){Object.setPrototypeOf(f,null);return 'renamed'}});return bind.call(f,{base:2},3)";
  const original = await run(source);
  const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{bound:original.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored = restoreGraph(JSON.parse(JSON.stringify(saved)),{source});
  const binding = restored.currentScope.lookup("bound");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored bound function");
  expect(getSandboxDataProperty(binding.value,"tag",restored.budget)).toBe("old");
  expect(await binding.value.call([])).toBe(5);
});
