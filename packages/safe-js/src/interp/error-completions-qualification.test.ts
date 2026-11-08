import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { Budget } from "./budget.js";

// ECMA-262 16, TryStatement Evaluation and IteratorClose. Expected traces
// are explicit specification oracles; the native engine is only a control.
it.each([
  ["return overrides throw", "try{throw 'body'}finally{t.push('finally');return 'return'}", ["finally", "return"]],
  ["throw overrides return", "try{return 'return'}finally{t.push('finally');throw 'final'}", ["finally", "final"]],
  ["continue overrides return", "for(let i=0;i<2;i++){try{return 'lost'}finally{t.push(i);continue}}return 'done'", [0, 1, "done"]],
  ["break overrides throw", "outer:for(;;){try{throw 'lost'}finally{t.push('finally');break outer}}return 'done'", ["finally", "done"]],
  ["nested catch binding failure", "try{try{throw null}catch({x}){}finally{t.push('inner')}}catch(e){t.push(e.name)}finally{t.push('outer')}return 'done'", ["inner", "TypeError", "outer", "done"]]
] as const)("qualifies %s through original and completed replay", async (_name, body, expected) => {
  const source = `const t=[];function f(){${body}}try{t.push(f())}catch(e){t.push(e)}return t`;
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  const original = await run(source);
  expect(original).toMatchObject({ ok: true, returnValue: expected });
  expect(await run(source, { snapshot: JSON.parse(await dump(original)) }))
    .toMatchObject({ ok: true, returnValue: expected });
});

it.each(["throw", "break"])("orders Proxy iterator close against a body %s", async completion => {
  const source = `const t=[];const body={},close={};
    const iterator=new Proxy({next(){return {value:1,done:false}},return(){t.push('close');throw close}},
      {get(target,key){t.push(String(key));return target[key]}});
    try{for(const value of {[Symbol.iterator](){return iterator}}){t.push('body');${completion === "throw" ? "throw body" : "break"}}}
    catch(e){t.push(e===body?'body error':e===close?'close error':'wrong')}
    return t`;
  const expected = ["next", "body", "return", "close", completion === "throw" ? "body error" : "close error"];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["return", "throw"])("retains a generator's injected %s across a yielding finally", async method => {
  const source = `const t=[];function* f(){try{yield 'body'}finally{t.push('finally:start');yield 'cleanup';t.push('finally:end')}}
    const g=f();t.push(g.next().value);t.push(g.${method}('injected').value);
    try{const end=g.next();t.push(end.value,end.done)}catch(e){t.push(e)}return t`;
  const expected = ["body", "finally:start", "cleanup", "finally:end", "injected", ...(method === "return" ? [true] : [])];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it("orders async cleanup rejection, synchronous failure, and outer finally", async () => {
  const source = `const t=[];const a={},b={};const s=new AsyncDisposableStack();
    s.defer(()=>{t.push('last');throw a});
    s.defer(async()=>{t.push('first:start');await 0;t.push('first:end');throw b});
    try{try{await s.disposeAsync()}catch(e){t.push(e instanceof SuppressedError,e.error===a,e.suppressed===b);throw 'outer'}}
    catch(e){t.push(e)}finally{t.push('finally',s.disposed)}return t`;
  const expected = ["first:start", "first:end", "last", true, true, true, "outer", "finally", true];
  const original = await run(source);
  expect(original).toMatchObject({ ok: true, returnValue: expected });
  expect(await run(source, { snapshot: JSON.parse(await dump(original)) }))
    .toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  "try{while(true){}}catch(e){note('catch')}finally{note('finally');return 'escaped'}",
  "function* f(){try{while(true){}}finally{note('finally');yield 'escaped'}}try{f().next()}catch(e){note('catch')}",
  "const s=new AsyncDisposableStack();s.defer(async()=>{while(true){}});try{await s.disposeAsync()}catch(e){note('catch')}finally{note('finally')}"
])("does not give guest cleanup fresh authority after budget exhaustion: %s", async source => {
  const trace: unknown[] = [];
  await expect(run(source, { budget: new Budget({ maxSteps: 300 }), bindings: { note: (value: unknown) => trace.push(value) } }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  expect(trace).toEqual([]);
});
