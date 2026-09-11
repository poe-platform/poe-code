import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Budget } from "../budget.js";

it.each([
  ["array definition throws", "const proxy=new Proxy([1],{defineProperty(){throw 'define'}})", false, ["define"]],
  ["object definition throws", "const proxy=new Proxy({a:1},{defineProperty(){throw 'define'}})", false, ["a", "define"]],
  ["object deletion throws", "const proxy=new Proxy({a:1},{deleteProperty(){throw 'delete'}})", true, ["a", "delete"]],
  ["ownKeys throws", "const proxy=new Proxy({a:1},{ownKeys(){throw 'keys'}})", false, ["keys"]],
  ["descriptor lookup throws", "const proxy=new Proxy({a:1},{getOwnPropertyDescriptor(){throw 'descriptor'}})", false, ["descriptor"]],
  ["array length getter throws", "const proxy=new Proxy([1],{get(t,k){if(k==='length')throw 'length';return Reflect.get(t,k)}})", false, ["length"]],
  ["array length conversion throws", "const proxy=new Proxy([1],{get(t,k){if(k==='length')return {valueOf(){throw 'convert'}};return Reflect.get(t,k)}})", false, ["convert"]],
  ["revoked array throws", "const revoked=Proxy.revocable([],{});const proxy=revoked.proxy;revoked.revoke()", false, ["TypeError"]],
  ["ordinary Proxy children are visited", "const proxy=new Proxy({a:1},{})", false, ["a", "done"]],
  ["nested Proxy children are visited", "const proxy=new Proxy(new Proxy({a:1},{}),{})", false, ["a", "done"]]
] as const)("JSON reviver %s", async (_name, setup, remove, expected) => {
  const source = `
    ${setup};
    const events=[];
    try{
      JSON.parse('["seed",null]',function(key,value){
        if(value==='seed')this[1]=proxy;
        if(key==='a'){events.push('a');${remove ? "return undefined;" : ""}}
        return value;
      });
      events.push('done');
    }catch(error){events.push(typeof error==='string'?error:error.name)}
    return events;
  `;
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["defineProperty", "deleteProperty"])("JSON reviver ignores a false %s result", async trap => {
  const source = `
    const events=[];
    const target={a:1};
    const proxy=new Proxy(target,{${trap}(){events.push('trap');return false}});
    JSON.parse('["seed",null]',function(key,value){
      if(value==='seed')this[1]=proxy;
      if(key==='a'){events.push('a');return ${trap === "deleteProperty" ? "undefined" : "2"}}
      return value;
    });
    return [events,target.a];
  `;
  const expected = [["a", "trap"], 1];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it("snapshots enumerable string keys and omits source context for inserted Proxy values", async () => {
  const source = `
    const events=[];const symbol=Symbol();
    const target={a:1,b:2,[symbol]:3};
    const proxy=new Proxy(target,{
      ownKeys(t){events.push('keys');return Reflect.ownKeys(t)},
      getOwnPropertyDescriptor(t,key){events.push('descriptor:'+String(key));return Reflect.getOwnPropertyDescriptor(t,key)}
    });
    JSON.parse('["seed",null]',function(key,value,context){
      if(value==='seed')this[1]=proxy;
      if(this===proxy){
        events.push([key,value,Object.hasOwn(context,'source')]);
        if(key==='a')delete target.b;
      }
      return value;
    });
    return events;
  `;
  const expected = ["keys", "descriptor:a", "descriptor:b", ["a", 1, false], ["b", undefined, false]];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it("uses coerced Proxy array length rather than enumerable array keys", async () => {
  const source = `
    const events=[];const target=[1,2];target.extra=3;
    const proxy=new Proxy(target,{get(t,key){
      if(key==='length')return {valueOf(){events.push('length');return 1.9}};
      return Reflect.get(t,key);
    }});
    JSON.parse('["seed",null]',function(key,value,context){
      if(value==='seed')this[1]=proxy;
      if(this===proxy)events.push([key,value,Object.hasOwn(context,'source')]);
      return value;
    });
    return events;
  `;
  const expected = ["length", ["0", 1, false]];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["pending", "completed"])("replays %s JSON traversal with an inserted Proxy", async mode => {
  const source = `
    const events=[];const target={a:1};const proxy=new Proxy(target,{});
    const value=JSON.parse('["seed",null]',function(key,value){
      if(value==='seed')this[1]=proxy;
      if(this===proxy){events.push(key);return value+1}
      return value;
    });
    await 0;
    return [value[1]===proxy,target.a,events];
  `;
  const expected = [true, 2, ["a"]];
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
  } finally { await completed; }
});

it("enforces array-length limits before traversing an inserted Proxy array", async () => {
  const source = `
    const proxy=new Proxy([], {get(t,key){
      if(key==='length')return 1024;
      if(key==='0')throw 'element read before budget check';
      return Reflect.get(t,key);
    }});
    return JSON.parse('["seed",null]',function(key,value){
      if(value==='seed')this[1]=proxy;
      return value;
    });
  `;
  await expect(run(source, { budget: new Budget({ arrayLength: 64 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength", current: 1024, limit: 64 });
});
