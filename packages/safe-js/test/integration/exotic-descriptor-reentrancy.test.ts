import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../src/run.js";

// ECMA-262 edition 16, 10.5.5: target descriptor/extensibility are captured
// before ToPropertyDescriptor reads the trap result. Literal traces are the
// oracle; execution in a separate native realm is an independent control.
it.each([false, true])("uses captured descriptor state when result getters freeze the target: %s", async frozen => {
  const source = `const log=[];const t={x:1,y:0};
    const target=new Proxy(t,{
      getOwnPropertyDescriptor(t,k){log.push('target:descriptor');return Reflect.getOwnPropertyDescriptor(t,k)},
      isExtensible(t){log.push('target:extensible');return Reflect.isExtensible(t)}});
    const p=new Proxy(target,{getOwnPropertyDescriptor(){log.push('trap');return {
      get configurable(){log.push('result:configurable');t.y++;Object.defineProperty(t,'x',{value:2,writable:false,configurable:false});return ${!frozen}},
      get value(){log.push('result:value');return 1},
      get writable(){log.push('result:writable');return ${!frozen}}
    }}});
    try{const d=Reflect.getOwnPropertyDescriptor(p,'x');log.push('result',d.value,d.configurable,d.writable)}catch(e){log.push(e.name)}
    return [log,t.x,t.y,Object.getOwnPropertyDescriptor(t,'x').configurable];`;
  const expected = [["trap", "target:descriptor", "target:extensible", "result:configurable", "result:value", "result:writable",
    ...(frozen ? ["TypeError"] : ["result", 1, true, true])], 2, 1, false];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([false, true])("captures extensibility before descriptor getters prevent extensions: %s", async configurable => {
  const source = `const log=[];const t={};const p=new Proxy(t,{getOwnPropertyDescriptor(){return {
    get configurable(){log.push('configurable');Object.preventExtensions(t);return ${configurable}},
    get value(){log.push('value');return 7}
  }}});try{const d=Reflect.getOwnPropertyDescriptor(p,'x');log.push(d.value,d.configurable)}catch(e){log.push(e.name)}
  return [log,Object.isExtensible(t),Reflect.has(t,'x')];`;
  const expected = [["configurable", "value", ...(configurable ? [7, true] : ["TypeError"])], false, false];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([false, true])("retains an in-flight descriptor trap through self revocation, throwing=%s", async throwing => {
  const source = `const log=[];const t={x:1};let r;const handler={
    get getOwnPropertyDescriptor(){log.push('trap:get');r.revoke();return function(target,key){
      log.push(this===handler,target===t,key);return {
        get enumerable(){log.push('enumerable');${throwing ? "throw 23" : "return true"}},
        get configurable(){log.push('configurable');return true},
        get value(){log.push('value');return 1}
      }}}
  };r=Proxy.revocable(t,handler);
  try{const d=Reflect.getOwnPropertyDescriptor(r.proxy,'x');log.push(d.value)}catch(e){log.push(e)}
  try{Reflect.getOwnPropertyDescriptor(r.proxy,'x')}catch(e){log.push(e.name)}return log;`;
  const expected = ["trap:get", true, true, "x", "enumerable",
    ...(throwing ? [23] : ["configurable", "value", 1]), "TypeError"];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([false, true])("finishes descriptor conversion before defineProperty trap lookup, throwing=%s", async throwing => {
  const source = `const log=[];const target={y:0};const handler={get defineProperty(){log.push('trap:get');return function(t,k,d){
    log.push(this===handler,t===target,k,Reflect.ownKeys(d).join(','));Object.defineProperty(t,k,d);return true}}};
  const p=new Proxy(target,handler);const d={get enumerable(){log.push('enumerable');target.y++;return true},
    get configurable(){log.push('configurable');return false},get value(){log.push('value');${throwing ? "throw 31" : "return 7"}},
    get writable(){log.push('writable');return false}};
  try{log.push(Reflect.defineProperty(p,'x',d))}catch(e){log.push(e)}return [log,target.y,Reflect.has(target,'x')];`;
  const expected = [["enumerable", "configurable", "value",
    ...(throwing ? [31] : ["writable", "trap:get", true, true, "x", "value,writable,enumerable,configurable", true])], 1, !throwing];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});
