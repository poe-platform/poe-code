import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";

// Current ECMA-262 draft requirements; older native engines accept 2 ** 53.
it.each(["take", "drop"])("%s enforces the range through direct SDK calls after cleanup", async method => {
  const result=await run(`const events=[];return [Iterator.prototype.${method},
    new Proxy({get next(){events.push('next')},return(){events.push('return');return {}}},{}),events]`);
  const values=result.returnValue;
  if (!result.ok || !Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK factory");
  await expect(values[0].call([2 ** 53],{stack:[],thisValue:values[1]})).rejects.toBeInstanceOf(RangeError);
  expect(values[2]).toEqual(["return"]);
});

it.each(["take", "drop"])("%s replays the limit rejection and close effects", async method => {
  const source=`let closed=0;const iterator={return(){closed++;return {}}};
    let error;try{Iterator.prototype.${method}.call(iterator,2 ** 53)}catch(e){error=e.name}
    await 0;return [error,closed]`;
  const original=await run(source);
  expect(original).toMatchObject({ok:true,returnValue:["RangeError",1]});
  expect(await run(source,{snapshot:JSON.parse(await dump(original))}))
    .toMatchObject({ok:true,returnValue:["RangeError",1]});
});

it.each(["take", "drop"])("%s rejects unsafe finite limits before reading next", async method => {
  for (const limit of ["2 ** 53", "Number.MAX_VALUE", "'9007199254740992'"]) {
    expect(await run(`const events=[];
      const iterator={get next(){events.push('next');return ()=>({done:true})},
        get return(){events.push('return');return function(){events.push(this===iterator);return {}}}};
      let error;try{Iterator.prototype.${method}.call(iterator,${limit})}catch(e){error=e.name}
      return [error,events]`))
      .toMatchObject({ok:true,returnValue:["RangeError",["return",true]]});
  }
});

it.each(["take", "drop"])("%s converts once and preserves range error over close failure", async method => {
  expect(await run(`const events=[];
    const iterator={get next(){events.push('next');throw 'next'},
      return(){events.push('return');throw 'close'}};
    const limit={[Symbol.toPrimitive](hint){events.push(hint);return 2 ** 53}};
    let error;try{Iterator.prototype.${method}.call(iterator,limit)}catch(e){error=e.name}
    return [error,events]`))
    .toMatchObject({ok:true,returnValue:["RangeError",["number","return"]]});
});

it.each(["take", "drop"])("%s accepts safe boundaries, fractions and positive infinity lazily", async method => {
  for (const limit of ["Number.MAX_SAFE_INTEGER", "Infinity", "0", "-0", "-0.5", "1.9"]) {
    expect(await run(`const events=[];
      const iterator={get next(){events.push('next');return ()=>{events.push('step');return {done:true}}},
        return(){events.push('return');return {}}};
      const helper=Iterator.prototype.${method}.call(iterator,${limit});
      return [typeof helper.next,events]`))
      .toMatchObject({ok:true,returnValue:["function",["next"]]});
  }
});
