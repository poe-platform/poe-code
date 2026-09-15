import { expect, it } from "vitest";
import { run } from "../src/run.js";

// ECMA-262 16: AsyncGeneratorYield / AsyncGeneratorUnwrapYieldResumption.
// Reduced from pinned Test262 yield-return-then-getter-ticks.js.
it("reads a queued return thenable between the first and second Promise reactions", async () => {
  const source = `const trace=[];
    async function* f(){ trace.push('start'); yield 123; }
    const ticks=Promise.resolve().then(()=>trace.push('tick 1')).then(()=>trace.push('tick 2'));
    const g=f(); const first=g.next();
    const last=g.return({get then(){trace.push('get then')}});
    await ticks; await first; await last; return trace;`;
  const expected = ["start", "tick 1", "get then", "tick 2"];
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  expect(await new AsyncFunction(source)()).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["body", "suspended", "start", "done"])(
  "awaits a %s return value exactly once",
  async (state) => {
    const setup =
      state === "body"
        ? "async function* f(){return value} const g=f(); const result=await g.next();"
        : `async function* f(){yield 1} const g=f();
       ${state === "suspended" ? "await g.next();" : state === "done" ? "await g.next(); await g.next();" : ""}
       const result=await g.return(value);`;
    const source = `let reads=0; const value={get then(){reads++;}};
    ${setup} return [reads,result.done,result.value===value];`;
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
    expect(await new AsyncFunction(source)()).toEqual([1, true, true]);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: [1, true, true] });
  }
);

it("awaits delegated return again when the delegate has no return method", async () => {
  const source = `const trace=[];
    const delegate={ [Symbol.asyncIterator](){return this},next(){return {done:false}},
      get return(){trace.push('get return')} };
    async function* f(){trace.push('start');yield* delegate;}
    const ticks=Promise.resolve().then(()=>trace.push('tick 1')).then(()=>trace.push('tick 2')).then(()=>trace.push('tick 3'));
    const g=f();const first=g.next();const last=g.return({get then(){trace.push('get then')}});
    await ticks;await first;await last;return trace;`;
  const expected = ["start", "tick 1", "get then", "tick 2", "get return", "get then", "tick 3"];
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  expect(await new AsyncFunction(source)()).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});
