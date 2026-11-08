import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([false,true])("selects the instance prototype after parameters (async=%s)", async async => {
  const source=`${async?'async ':''}function* g(a=(g.prototype={newPrototype:true})){}
    const old=g.prototype;const iterator=g();return [Object.getPrototypeOf(iterator)===old,Object.getPrototypeOf(iterator)===g.prototype,iterator.newPrototype];`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:[false,true,true]});
});

it.each([false,true])("uses the intrinsic fallback after parameters clear the prototype (async=%s)", async async => {
  const source=`${async?'async ':''}function* g(a=(g.prototype=null)){}
    const old=g.prototype;const intrinsic=Object.getPrototypeOf(old);const iterator=g();return [Object.getPrototypeOf(iterator)===old,Object.getPrototypeOf(iterator)===intrinsic];`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:[false,true]});
});

it.each([false,true])("retains the selected prototype across repeated replay (async=%s)", async async => {
  const source=`let initialized=0;${async?'async ':''}function* g(a=(initialized++,g.prototype=Object.create(g.prototype,{tag:{value:7}}))){yield 3;yield 4}
    const iterator=g();await 0;const first=await iterator.next();await 0;return [first,await iterator.next(),iterator.tag,initialized,g.toString(),(await g.constructor('return typeof process+","+typeof require')().next()).value];`;
  let pending=run(source);const results=[];
  for(let i=0;i<3;i++){
    const settled=pending.catch(error=>error);
    try{const saved=JSON.parse(await dump(pending));results.push(await settled);pending=run(source,{snapshot:restore(saved,{source})});}finally{await settled;}
  }
  results.push(await pending);
  results.push(await run(source,{snapshot:restore(JSON.parse(await dump(pending)),{source})}));
  for(const result of results){expect(result).toMatchObject({ok:true,returnValue:[{value:3,done:false},{value:4,done:false},7,1,expect.stringContaining('function* g('),'undefined,undefined']});}
});
