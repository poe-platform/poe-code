import { expect, it } from "vitest";
import { run } from "../src/run.js";

// ECMA-262 16, Promise.prototype.finally creates length-one then/catch closures.
// Pinned Test262: built-ins/Promise/prototype/finally/invokes-then-with-function.js.
it("exposes length-one, anonymous, nonconstructible finally handlers", async () => {
  const source = `const p=Promise.resolve();let result;
    p.then=(a,b)=>{result=[a.length,b.length,a.name,b.name];
      for(const f of [a,b]){try{new f();result.push(false)}catch(e){result.push(e instanceof TypeError)}}};
    p.finally(()=>{});return result;`;
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  expect(await new AsyncFunction(source)()).toEqual([1, 1, "", "", true, true]);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: [1, 1, "", "", true, true] });
});

it("passes noncallable handlers through unchanged", async () => {
  expect(
    await run(`const p=Promise.resolve();p.then=(a,b)=>[a,b];return p.finally(7);`)
  ).toMatchObject({ ok: true, returnValue: [7, 7] });
});
