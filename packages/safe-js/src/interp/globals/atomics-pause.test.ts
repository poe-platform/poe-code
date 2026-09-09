import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Budget } from "../budget.js";
import { isSandboxClosure } from "../values.js";
import { createAtomicsGlobal } from "./atomics.js";

it("exposes the non-constructible zero-argument pause intrinsic", async () => {
  const source = `const d=Object.getOwnPropertyDescriptor(Atomics,"pause");
    let error;try{new Atomics.pause()}catch(e){error=e.name}
    return [typeof d.value,d.value.name,d.value.length,d.writable,d.enumerable,d.configurable,error];`;
  await expect(run(source)).resolves.toMatchObject({
    ok: true, returnValue: ["function", "pause", 0, true, false, true, "TypeError"]
  });
});

it("ignores arguments and receivers without coercing or inspecting them", async () => {
  const source = `let calls=0;const value=new Proxy({},{get(){calls++;throw Error("inspected")}});
    const inputs=[undefined,null,-1,1.5,NaN,Infinity,"1",1n,Symbol(),value];
    const results=inputs.map(input=>Atomics.pause.call(value,input,value)===undefined);
    return [results.every(Boolean),calls];`;
  await expect(run(source)).resolves.toMatchObject({ok:true,returnValue:[true,0]});
});

it("preserves pause aliases and mutations through completed public replay", async () => {
  const source = `const pause=Atomics.pause;pause.extra=7;await 0;
    return [pause===Atomics.pause,pause.extra,pause()===undefined,pause.bind(null).length];`;
  const original = await run(source);
  expect(original).toMatchObject({ok:true,returnValue:[true,7,true,0]});
  const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
  expect(replayed).toMatchObject({ok:true,returnValue:[true,7,true,0]});
});

it("charges the step budget even when no native pause hint is available", () => {
  const pause = createAtomicsGlobal(new Budget({maxSteps:1})).pause;
  if (!isSandboxClosure(pause)) throw new Error("Missing pause intrinsic");
  expect(pause.call([])).toBeUndefined();
  expect(() => pause.call([])).toThrow(expect.objectContaining({code:"budgetExceeded",budget:"steps",current:2,limit:1}));
});
