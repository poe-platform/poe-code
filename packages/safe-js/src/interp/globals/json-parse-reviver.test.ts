import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  'return JSON.parse("{\\"x\\":1}",(key,value)=>key==="x"?value+1:value)',
  'const log=[];JSON.parse("[1e2,-0,1e500,true,null,\\"a\\\\nb\\"]",(key,value,context)=>{log.push([key,context.source,Object.keys(context)]);return value});return log',
  'const log=[];JSON.parse("{\\"x\\":1,\\"y\\":2}",function(key,value,context){if(key==="x")this.y=3;log.push([key,context.source]);return value});return log',
  'const log=[];JSON.parse("{\\"x\\":1,\\"y\\":{\\"z\\":2}}",function(key,value,context){if(key==="x")this.y={z:2};log.push([key,context.source]);return value});return log',
  'const log=[];JSON.parse("{\\"x\\":1,\\"x\\":2}",(key,value,context)=>{log.push([key,value,context.source]);return value});return log',
  'const log=[];JSON.parse("{\\"__proto__\\":1}",function(key,value,context){log.push([key,context.source,Object.hasOwn(this,key)]);return value});return log',
  'const log=[];JSON.parse("[1,2,3]",function(key,value){if(key==="0")this.length=1;log.push([key,value]);return value});return log',
  'const log=[];JSON.parse("[1,2]",function(key,value){if(key==="0")this.push(3);log.push(key);return value});return log',
  'return JSON.parse("{\\"x\\":1,\\"y\\":2}",function(key,value){if(key==="x")Object.defineProperty(this,"y",{value:3,configurable:false});return key==="y"?undefined:value})',
  'return JSON.parse("{\\"x\\":1,\\"y\\":2}",function(key,value){if(key==="x")Object.defineProperty(this,"y",{value:3,configurable:false});return key==="y"?8:value})',
  'const log=[];JSON.parse("{\\"x\\":1,\\"y\\":2}",function(key,value,context){if(key==="x")Object.defineProperty(this,"y",{get(){log.push("get");return 9},configurable:true});log.push([key,value,context.source]);return value});return log',
  'const contexts=[];JSON.parse("[1,2]",function(key,value,context){contexts.push(context);return value});return [contexts.length,contexts[0]!==contexts[1],Object.getPrototypeOf(contexts[0])===Object.prototype]',
  'return JSON.parse("{\\"x\\":1}",function(key,value){return key===""?undefined:value})',
  'return [JSON.parse("1",null),JSON.parse("1",{}),JSON.parse("1",42)]',
  'return JSON.parse("{\\"x\\":1,\\"y\\":2}",(key,value)=>key==="x"?undefined:value)',
  'return JSON.parse("1",(key,value)=>({key,value}))',
  'const log=[];JSON.parse("{\\"a\\":[1,2]}",function(key,value){log.push([key,Array.isArray(this),typeof value]);return value});return log',
  'const result=JSON.parse("[1,2]",(key,value)=>key==="0"?undefined:value);return [result.length,0 in result,result[1]]',
  'try{JSON.parse("1",()=>{throw 7})}catch(error){return error}',
  'return JSON.parse("{\\"x\\":1,\\"y\\":2}",function(key,value){if(key==="x")this.y=8;return value})',
  'const log=[];JSON.parse("{\\"x\\":1}",function(key,value){if(key==="x")this.added=2;log.push(key);return value});return log'
])("matches native JSON reviver: %s", async source => {
  const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
  const result = await run(source);
  expect(result.ok).toBe(true);
  expect(result.returnValue).toEqual(expected);
});

it("uses SameValue to invalidate source context when negative zero becomes positive zero", async () => {
  // InternalizeJSONProperty uses SameValue, not numeric equality. Node 22
  // incorrectly keeps the source in this case, so it is not the oracle here.
  const source = 'const log=[];JSON.parse("{\\"x\\":1,\\"y\\":-0}",function(key,value,context){if(key==="x")this.y=0;log.push([key,context.source]);return value});return log';
  expect((await run(source)).returnValue).toEqual([["x", "1"], ["y", undefined], ["", undefined]]);
});

it("advertises both parse parameters", async () => {
  expect((await run("return JSON.parse.length")).returnValue).toBe(2);
});

it("preserves source on runtimes without native reviver context", async () => {
  const parse = JSON.parse;
  const mock = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) =>
    parse(text, reviver === undefined ? undefined : function (key, value) {
      return reviver.call(this, key, value);
    }));
  try {
    expect((await run('return JSON.parse("1e2",(key,value,context)=>context.source)')).returnValue).toBe("1e2");
  } finally { mock.mockRestore(); }
});

it.each([
  ' \n { "a" : [ {}, [], "quote: \\" slash: \\\\", -1.25e-10 ], "b" : null } \t',
  '{"a":{"lost":[1]},"a":{"kept":2}}',
  '{"2":2,"1":1,"z":0,"2":3}',
  '{"__proto__":{"x":1},"__proto__":[2]}',
  '["\\ud800","\\udfff","\\u0061","é","🍋","",false,true,null]',
  ' { "" : 1, "a,b]}": " ,]} " } ',
  '[]', '{}', ' -0 ', ' 1e500 '
])("captures source records for %s", async text => {
  const source = `const log=[];const value=JSON.parse(${JSON.stringify(text)},(key,value,context)=>{log.push([key,context.source]);return value});return [value,log]`;
  const expected = runInNewContext(`(()=>{${source}})()`);
  const result = await run(source);
  expect(result.ok).toBe(true);
  expect(result.returnValue).toEqual(expected);
});

it("does not unwrap asynchronous reviver results or drain their jobs", async () => {
  const source = 'const log=[];const result=JSON.parse("[1,2]",async function(key,value){log.push(key);await 0;log.push("job");return value});log.push(result instanceof Promise);await result;return log';
  const expected = await runInNewContext(`(async()=>{${source}})()`);
  expect((await run(source)).returnValue).toEqual(expected);
});

it.each(["pending", "completed"])("restores %s reviver checkpoints", async mode => {
  const source = 'const log=[];const result=JSON.parse("{\\"x\\":1}",(key,value,context)=>{log.push([key,context.source]);return typeof value==="number"?value+1:value});await 0;return [result,log]';
  const expected = await runInNewContext(`(async()=>{${source}})()`);
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect((await completed).returnValue).toEqual(expected);
    expect((await run(source, { snapshot })).returnValue).toEqual(expected);
  } finally { await completed; }
});

it("does not repeat completed reviver host effects", async () => {
  const source = 'return JSON.parse("[1,2]",(key,value)=>{record(key);return value})';
  const keys: string[] = [];
  const bindings = { record(key: string) { keys.push(key); } };
  const result = await run(source, { bindings });
  const snapshot = restore(JSON.parse(await dump(result)), { source });
  expect((await run(source, { bindings, snapshot })).returnValue).toEqual([1, 2]);
  expect(keys).toEqual(["0", "1", ""]);
});

it("keeps reviver step exhaustion fatal and releases roots", async () => {
  const budget = new Budget({ maxSteps: 1000 });
  await expect(run('try{return JSON.parse("1",()=>{while(true){}})}catch(error){return 0}', { budget }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  expect([...budget.retainedValues()]).toEqual([]);
});

it("bounds cycles introduced by revivers", async () => {
  const budget = new Budget({ maxCallDepth: 20 });
  await expect(run('try{return JSON.parse("{\\"x\\":1,\\"y\\":2}",function(key,value){if(key==="x")this.y=this;return value})}catch(error){return 0}', { budget }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
  expect([...budget.retainedValues()]).toEqual([]);
});
