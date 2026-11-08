import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  'return Number(new Proxy({valueOf(){return 7}},{}))',
  'return String(new Proxy({toString(){return "seven"}},{}))',
  'return BigInt(new Proxy({valueOf(){return 7n}},{}))',
  'return Number(new Proxy({},{get(t,k){return k===Symbol.toPrimitive?hint=>hint==="number"?7:0:undefined}}))',
  'const value=Object.create(new Proxy({get valueOf(){if(this!==value)throw Error("receiver");return ()=>7}},{}));return Number(value)',
  'return String(new Proxy(new Proxy({toString(){return "seven"}},{}),{}))',
  'return Number(new Proxy({valueOf:new Proxy(()=>7,{apply(t,r,a){return Reflect.apply(t,r,a)}})},{}))',
  'const pair=Proxy.revocable({},{});pair.revoke();try{Number(pair.proxy)}catch(error){return error instanceof TypeError}',
  'const calls=[];const value=new Proxy({valueOf(){calls.push("valueOf");return {}},toString(){calls.push("toString");return "7"}},{get(t,k,r){calls.push(String(k));return Reflect.get(t,k,r)}});return [Number(value),calls]'
])("matches native Proxy primitive conversion: %s", async source => {
  const native = new Function(source)();
  expect((await run(source)).returnValue).toEqual(native);
});
