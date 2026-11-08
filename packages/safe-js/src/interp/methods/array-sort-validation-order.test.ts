import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["sort", "toSorted"])("%s rejects invalid comparators before observing the receiver", async method => {
  const source = `
    const events=[];
    const receiver={get length(){events.push('length');throw 'length read'}};
    const invalid=[null,true,false,'',/a/,42,42n,[],{},Symbol()];
    const errors=[];
    for(const compare of invalid){
      try{Array.prototype.${method}.call(receiver,compare)}catch(error){errors.push(error.name)}
    }
    return [events,errors];
  `;
  const expected = [[], Array(10).fill("TypeError")];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["sort", "toSorted"])("%s still reads length after accepting the comparator", async method => {
  const source = `
    const events=[];
    for(const compare of [undefined,()=>0]){
      const receiver={get length(){events.push('length');return 0}};
      Array.prototype.${method}.call(receiver,compare);
    }
    return events;
  `;
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(["length", "length"]);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: ["length", "length"] });
});
