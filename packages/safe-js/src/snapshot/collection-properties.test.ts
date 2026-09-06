import { expect, it } from "vitest";
import { Budget, SandboxError } from "../interp/budget.js";
import { accessorAdapter } from "../interp/accessors.js";
import { createSandboxClosure, reconcileCompiledValues } from "../interp/values.js";
import { cloneSandboxValue, createSandboxMap, createSandboxSet, deepCopyFromSandbox, deepCopyToSandbox, getCollectionProperties, measureSandboxData, type SandboxMap, type SandboxSet } from "../interp/values.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

const cases = ["Map", "Set"].flatMap(name => ["snapshot", "replay", "clone", "host"].map(format => ({name,format})));

it.each(["Map","Set"])("charges retained accessor closures on %s at budget checkpoints", name => {
  const value=name === "Map" ? createSandboxMap() : createSandboxSet();
  const getter=createSandboxClosure({sandbox:true,call:()=>7,retainedValues:()=>["x".repeat(1000)]});
  Object.defineProperty(getCollectionProperties(value),"label",{get:accessorAdapter(getter,"get")});
  expect(()=>reconcileCompiledValues(new Budget({dataSize:50}),[value])).toThrow(SandboxError);
});

it.each(["Map","Set"])("preserves own data descriptors on native %s input", name => {
  const value=name === "Map" ? new Map() : new Set();
  Object.defineProperty(value,"self",{value,enumerable:true});
  Object.preventExtensions(value);
  const copied=deepCopyToSandbox(value) as SandboxMap | SandboxSet;
  expect(Object.getOwnPropertyDescriptor(getCollectionProperties(copied),"self")).toEqual({value:copied,enumerable:true,writable:false,configurable:false});
  expect(Object.isExtensible(getCollectionProperties(copied))).toBe(false);
});

it.each(cases)("preserves $name own descriptors and cycles through $format", ({name,format}) => {
  const value=name === "Map" ? createSandboxMap() : createSandboxSet();
  const properties=getCollectionProperties(value);
  Object.defineProperty(properties,"self",{value,enumerable:true});
  Object.preventExtensions(properties);
  let restored: unknown;
  if(format === "clone") restored=cloneSandboxValue(value);
  else if(format === "host") restored=deepCopyFromSandbox(value);
  else if(format === "replay") restored=decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(value))));
  else {
    const source="await task()";
    const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{value}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget:new Budget()}).currentScope.lookup("value");
    if(!binding.found) throw new Error("Missing collection binding");
    restored=binding.value;
  }
  const result=format === "host" ? restored as object : getCollectionProperties(restored as SandboxMap|SandboxSet);
  expect(Object.getOwnPropertyDescriptor(result,"self")).toEqual({value:restored,enumerable:true,writable:false,configurable:false});
  expect(Object.isExtensible(result)).toBe(false);
});

it.each(["Map","Set"])("accounts for %s own property data", name => {
  const value=name === "Map" ? createSandboxMap() : createSandboxSet();
  const before=measureSandboxData([value]);
  getCollectionProperties(value).payload="x".repeat(1000);
  expect(measureSandboxData([value])-before).toBeGreaterThanOrEqual(1000);
});

it.each(cases.filter(test => test.format === "snapshot" || test.format === "replay").flatMap(test =>
  ["duplicate", "key", "flags", "accessor"].map(mutation => ({...test,mutation}))))(
  "rejects $mutation descriptors for $name in $format", ({name,format,mutation}) => {
    const value=name === "Map" ? createSandboxMap() : createSandboxSet();
    getCollectionProperties(value).label=7;
    const source="await task()";
    const encoded=JSON.parse(JSON.stringify(format === "replay" ? encodeReplayData(value)
      : serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{value}}],callStack:[],pendingPromises:[],moduleBindings:{}})));
    const nodes=format === "replay" ? encoded.nodes : Object.values(encoded.heap);
    const node=nodes.find((entry: {kind:string}) => entry.kind === name.toLowerCase());
    const descriptor=node.propertyState.properties[0];
    if(mutation === "duplicate") node.propertyState.properties.push(descriptor);
    if(mutation === "key") descriptor[0]=123;
    if(mutation === "flags") descriptor[1].writable="yes";
    if(mutation === "accessor") descriptor[1]={kind:"accessor",get:7,set:8,enumerable:true,configurable:true};
    expect(() => format === "replay" ? decodeReplayData(encoded)
      : restore(encoded,{source,budget:new Budget()})).toThrow();
  }
);
