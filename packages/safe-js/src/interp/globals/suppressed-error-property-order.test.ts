import { expect, it } from "vitest";
import { run } from "../../run.js";

// Pinned Test262: built-ins/SuppressedError/order-of-args-evaluation.js.
// Explicit Resource Management: message precedes error and suppressed.
it("keeps SuppressedError fields adjacent after message coercion", async () => {
  expect(await run(`const trace=[];const error=new SuppressedError(1,2,{toString(){trace.push('message');return 'text'}});
    const keys=Object.getOwnPropertyNames(error);const index=keys.indexOf('message');
    return [trace,keys.slice(index,index+3),error.error,error.suppressed]`))
    .toMatchObject({ ok: true, returnValue: [["message"], ["message", "error", "suppressed"], 1, 2] });
});

it("does not create an absent message", async () => {
  expect(await run("const e=new SuppressedError(1,2);return [Object.hasOwn(e,'message'),e.error,e.suppressed]"))
    .toMatchObject({ ok: true, returnValue: [false, 1, 2] });
});
