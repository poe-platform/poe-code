import { expect, it } from "vitest";
import { run } from "../../run.js";

it("rejects BigInt Number formatting arguments", async () => {
  expect(await run("try{return (1).toFixed(1n)}catch(error){return error.name}"))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it.each(["isNaN(1n)", "isFinite(1n)", "Array.from({length:1n})", "'abc'.slice(1n)", "(1n).toString(2n)", "BigInt.asIntN(2n,1n)", "BigInt.asUintN(2,1)", "BigInt.asIntN(-1,0n)", "Number(Object(3n))", "Number({valueOf(){return 3n}})", "BigInt({valueOf(){return 3}})", "BigInt.asIntN(8,{valueOf(){return 255n}})"])("matches native conversion: %s", async expression => {
  const source=`try{return ${expression}}catch(error){return error.name}`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});
