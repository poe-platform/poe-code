import { expect, it } from "vitest";
import { run } from "../../run.js";
import { cloneSandboxValue } from "../values.js";
import { createSandboxTemporalInstant, temporalInstantEpoch } from "../temporal-instant.js";

it.each([
  "new Temporal.Instant(1n)",
  "Object.setPrototypeOf(new Temporal.Instant(1n),null)",
  "new (class extends Temporal.Instant {})(1n)",
  "[new Temporal.Instant(1n)]",
  "new Map([[new Temporal.Instant(1n),1]])"
])("rejects structured cloning of %s with DataCloneError", async expression => {
  expect(await run(`try { structuredClone(${expression}); return 'accepted'; } catch(error) { return error.name; }`))
    .toMatchObject({ok:true,returnValue:"DataCloneError"});
});

it("does not read Instant properties or detach transfers when serialization fails", async () => {
  expect(await run(`let reads=0;const value=new Temporal.Instant(1n);
    Object.defineProperty(value,'label',{enumerable:true,get(){reads++;throw 'invoked'}});
    const buffer=new ArrayBuffer(4);let name;
    try {structuredClone({buffer,value},{transfer:[buffer]})}catch(error){name=error.name}
    return [name,reads,buffer.byteLength]`))
    .toMatchObject({ok:true,returnValue:["DataCloneError",0,4]});
});

it("keeps explicit data-copy semantics distinct from structured cloning", () => {
  const value=createSandboxTemporalInstant(-1n);
  expect(temporalInstantEpoch(cloneSandboxValue(value))).toBe(-1n);
  expect(() => cloneSandboxValue(value,{structuredClone:true}))
    .toThrow(expect.objectContaining({name:"DataCloneError"}));
});
