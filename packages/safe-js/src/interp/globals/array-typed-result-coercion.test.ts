import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

const cases = [
  ["from", "await Array.from.call(C,source)", true],
  ["fromAsync", "await Array.fromAsync.call(C,source)", true],
  ["of", "Array.of.call(C,value)", true],
  ["map", "source.map(x=>x)", false],
  ["filter", "source.filter(()=>true)", false],
  ["slice", "source.slice()", true],
  ["concat", "source.concat()", true],
  ["flat", "source.flat()", false],
  ["flatMap", "source.flatMap(x=>x)", false],
  ["splice", "source.splice(0,1)", true]
] as const;

for (const [type, primitive, stored] of [
  ["Uint8Array", "257", "1"],
  ["BigInt64Array", "257n", "257"]
] as const) {
  it.each(cases)(`${type} result of %s converts guest elements`, async (method, expression, setsLength) => {
    const source = `
      const events=[];
      const target=new ${type}(1);
      const value={valueOf(){events.push('convert');return ${primitive}}};
      function C(){return target}
      const source=[value];source.constructor={[Symbol.species]:C};
      try{${expression}}catch(error){events.push(error.name)}
      return [events,String(target[0])];
    `;
    const expected = [setsLength ? ["convert", "TypeError"] : ["convert"], stored];
    if (method !== "fromAsync" || runInNewContext("typeof Array.fromAsync") === "function") {
      const native = await runInNewContext(`(async()=>{${source}})()`);
      if (method === "fromAsync") {
        // Native fromAsync may omit the required failing length assignment.
        // Qualify its conversion only; the guest still checks the final error.
        expect(native[0][0]).toBe("convert");
        expect(native[1]).toBe(stored);
      } else {
        expect(native).toEqual(expected);
      }
    }
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
}

it.each(cases)("%s rejects out-of-bounds typed result indices before coercion", async (method, expression) => {
  const source = `
    const events=[];
    const target=new Uint8Array(0);
    const value={valueOf(){events.push('convert');return 257}};
    function C(){return target}
    const source=[value];source.constructor={[Symbol.species]:C};
    try{${expression}}catch(error){events.push(error.name)}
    return events;
  `;
  if (method !== "fromAsync") {
    expect(await runInNewContext(`(async()=>{${source}})()`)).toEqual(["TypeError"]);
  }
  expect(await run(source)).toMatchObject({ ok: true, returnValue: ["TypeError"] });
});
