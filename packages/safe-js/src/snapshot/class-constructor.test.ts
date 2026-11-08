import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { serialize } from "./serialize.js";
import { restore as restoreRuntime } from "./restore.js";
import { Budget } from "../interp/budget.js";
import { getSandboxDataProperty, getSandboxPropertyDescriptor, getSandboxPrototype } from "../interp/object-model.js";
import { readPropertyDescriptor } from "../interp/accessors.js";
import { isSandboxMap, type SandboxCallContext, type SandboxClosure, type SandboxValue } from "../interp/values.js";

it("restores constructors without repeating computed keys or static blocks", async () => {
  const source=`let effects=0;function key(){effects++;return "field"}
    class Plain { [key()]=7;static {effects++} }
    function count(){return effects}`;
  const evaluated=await run(source);
  const bindings=evaluated.snapshot.bindings as Record<string,SandboxValue>;
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{Plain:bindings.Plain,count:bindings.count}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const restored=restoreRuntime(JSON.parse(JSON.stringify(snapshot)),{source,budget});
  const plain=restored.currentScope.lookup("Plain");
  const count=restored.currentScope.lookup("count");
  if(!plain.found || !count.found) throw new Error("Missing restored class bindings");
  const constructor=plain.value as SandboxClosure;
  const counter=count.value as SandboxClosure;
  const context: SandboxCallContext={stack:[],thisValue:undefined,getProperty:(value,key)=>getSandboxDataProperty(value,key,budget)};
  expect(await counter.call([],context)).toBe(2);
  const instance=await constructor.construct!([],context);
  expect(getSandboxDataProperty(instance,"field",budget)).toBe(7);
  expect(getSandboxPrototype(instance as object,budget)).toBe(getSandboxDataProperty(constructor,"prototype",budget));
  expect(await counter.call([],context)).toBe(2);
});

it("constructs fresh Map subclass instances from a restored class graph", async () => {
  const source="class Derived extends Map { label=7 }";
  const evaluated=await run(source);
  const Derived=(evaluated.snapshot.bindings as Record<string,SandboxValue>).Derived;
  const encoded=serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{Derived}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const restored=restoreRuntime(JSON.parse(JSON.stringify(encoded)),{source,budget});
  const binding=restored.currentScope.lookup("Derived");
  if(!binding.found) throw new Error("Missing restored derived class");
  const constructor=binding.value as SandboxClosure;
  const context: SandboxCallContext={stack:[],thisValue:undefined,
    getProperty:(value,key)=>{
      const descriptor=getSandboxPropertyDescriptor(value,key,budget);
      return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor,value,context);
    },
    invokeClosure:async (closure,args,thisValue,construct,newTarget) => {
      const invoke=construct ? closure.construct! : closure.call;
      return invoke(args,{...context,thisValue,newTarget});
    }};
  const instance=await constructor.construct!([[["answer",42]]],context);
  expect(isSandboxMap(instance)).toBe(true);
  if(!isSandboxMap(instance)) throw new Error("Restored constructor lost Map storage");
  expect(instance.entries.get("answer")).toBe(42);
  expect(getSandboxDataProperty(instance,"label",budget)).toBe(7);
  expect(getSandboxPrototype(instance,budget)).toBe(getSandboxDataProperty(constructor,"prototype",budget));
});

it.each(["ast", "field-index", "field-key", "missing-field", "scope", "writable-prototype", "missing-prototype"])(
  "rejects invalid class checkpoint metadata: %s", async mutation => {
    const source="class Plain { value=7 }";
    const result=await run(source);
    const Plain=(result.snapshot.bindings as Record<string,SandboxValue>).Plain;
    const encoded=JSON.parse(JSON.stringify(serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{Plain}}],callStack:[],pendingPromises:[],moduleBindings:{}})));
    const [id,node]=Object.entries(encoded.heap).find(([,entry])=>(entry as {kind:string}).kind === "guest-class")! as [string, {
      astNodeId:number;fields:Array<{index:number;key:unknown}>;scope:unknown;
      state:{properties:{properties:Array<[string,{writable:boolean}]>}}
    }];
    if(mutation === "ast") node.astNodeId=999999;
    if(mutation === "field-index") node.fields[0].index=999;
    if(mutation === "field-key") node.fields[0].key="changed";
    if(mutation === "missing-field") node.fields=[];
    if(mutation === "scope") node.scope={kind:"ref",id:Number(id)};
    const properties=node.state.properties.properties;
    if(mutation === "writable-prototype") properties.find(([key]:[string,unknown])=>key === "prototype")[1].writable=true;
    if(mutation === "missing-prototype") node.state.properties.properties=properties.filter(([key]:[string,unknown])=>key !== "prototype");
    expect(()=>restoreRuntime(encoded,{source,budget:new Budget()})).toThrow();
  }
);

it.each(["pending","completed"])("restores ordinary class constructors from %s checkpoints", async mode => {
  const source=`class Plain { value=7; read(){return this.value} } const first=new Plain();await 0;
    return [first instanceof Plain,first.read(),new Plain().read()]`;
  const pending=run(source);
  const completed=pending.catch(error=>error);
  try {
    if(mode === "completed") await completed;
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    expect(await completed).toMatchObject({ok:true,returnValue:[true,7,7]});
    expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[true,7,7]});
  } finally {await completed;}
});
