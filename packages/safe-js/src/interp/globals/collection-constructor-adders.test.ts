import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

const collections = [
  {name:"Map",method:"set",input:"[[1,2],[3,4]]",arguments:[[1,2],[3,4]],entry:"[1,2]"},
  {name:"Set",method:"add",input:"[1,2]",arguments:[[1],[2]],entry:"1"}
];

it.each(collections)("restores construction with an overridden $name adder", async config => {
  const source = `const calls=[];const original=${config.name}.prototype.${config.method};
    ${config.name}.prototype.${config.method}=function(...args){calls.push(args);return original.apply(this,args)};
    await 0;const value=new ${config.name}(${config.input});await 0;return [calls,value.size]`;
  const pending=run(source);
  const completed=pending.catch(error=>error);
  try {
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    expect(await completed).toMatchObject({ok:true,returnValue:[config.arguments,2]});
    expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[config.arguments,2]});
  } finally {await completed;}
});

it("reads Map entry keys and values before calling the adder", async () => {
  const source=`const calls=[];Map.prototype.set=function(key,value){calls.push([key,value])};
    new Map([{get 0(){calls.push("key");return 1},get 1(){calls.push("value");return 2}}]);return calls`;
  expect((await run(source)).returnValue).toEqual(["key","value",[1,2]]);
});

it.each(collections)("does not read the $name adder for nullish input", async config => {
  const source = `Object.defineProperty(${config.name}.prototype,"${config.method}",{get(){throw new Error("read")}});
    return [new ${config.name}().size,new ${config.name}(null).size,new ${config.name}(undefined).size]`;
  expect((await run(source)).returnValue).toEqual([0,0,0]);
});

it.each(collections)("validates the $name adder before accessing the iterator", async config => {
  const source = `const calls=[];Object.defineProperty(${config.name}.prototype,"${config.method}",{get(){calls.push("adder");return 1}});
    const input={get [Symbol.iterator](){calls.push("iterator");throw new Error("wrong order")}};
    try{new ${config.name}(input)}catch(error){return [error.name,calls]}`;
  expect((await run(source)).returnValue).toEqual(["TypeError",["adder"]]);
});

it.each(collections)("ignores a promise returned by the $name adder", async config => {
  const source = `const calls=[];${config.name}.prototype.${config.method}=async function(...args){calls.push(args);await new Promise(()=>{});calls.push("unreachable")};
    const value=new ${config.name}(${config.input});return [calls,value.size]`;
  expect((await run(source)).returnValue).toEqual([config.arguments,0]);
});

it.each(collections)("supports delegating from an overridden $name adder", async config => {
  const source = `const original=${config.name}.prototype.${config.method};const calls=[];
    ${config.name}.prototype.${config.method}=function(...args){calls.push(args);return original.apply(this,args)};
    const value=new ${config.name}(${config.input});return [calls,value.size]`;
  expect((await run(source)).returnValue).toEqual([config.arguments,2]);
});

it.each(collections)("uses overridden $name.prototype.$method during construction", async config => {
  const source = `const calls=[];let receiver;${config.name}.prototype.${config.method}=function(...args){receiver=this;calls.push(args);return this};
    const value=new ${config.name}(${config.input});return [calls,receiver===value,value.size]`;
  expect((await run(source)).returnValue).toEqual([config.arguments,true,0]);
});

it.each(collections)("reads and caches the $name adder once", async config => {
  const source = `const calls=[];Object.defineProperty(${config.name}.prototype,"${config.method}",{get(){calls.push("get");return function(...args){
    calls.push(args);Object.defineProperty(${config.name}.prototype,"${config.method}",{value:()=>{throw new Error("changed")}})
  }}});new ${config.name}(${config.input});return calls`;
  expect((await run(source)).returnValue).toEqual(["get",...config.arguments]);
});

it.each(collections)("rejects a non-callable $name adder even for an empty iterable", async config => {
  const source = `${config.name}.prototype.${config.method}=1;try{new ${config.name}([]);return "accepted"}catch(error){return error.name}`;
  expect((await run(source)).returnValue).toBe("TypeError");
});

it.each(collections)("closes the iterator when the $name adder throws", async config => {
  const source = `const calls=[];const failure={};let index=0;${config.name}.prototype.${config.method}=()=>{throw failure};
    const input={[Symbol.iterator](){return {next(){calls.push("next");return {done:index++>0,value:${config.entry}}},return(){calls.push("close");return {done:true}}}}};
    try{new ${config.name}(input);return "accepted"}catch(error){return [error===failure,calls]}`;
  expect((await run(source)).returnValue).toEqual([true,["next","close"]]);
});
