import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { dump } from "../dump.js";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";

it.each(["start", "yield", "completed"].flatMap(state => ["await", "then"].map(delivery => ({ state, delivery }))))(
  "preserves a throwing return Promise constructor at $state through $delivery", async ({ state, delivery }) => {
  const source = `const t=[];const marker=new Error('broken');const p=Promise.resolve(42);
    Object.defineProperty(p,'constructor',{get(){t.push('constructor');throw marker}});
    async function* f(){try{yield 1}catch(e){t.push('catch',e===marker,e.message);return 7}finally{t.push('finally')}}
    const g=f();${state === "start" ? "" : "await g.next();"}${state === "completed" ? "await g.next();" : ""}
    ${delivery === "await" ? "try{const r=await g.return(p);t.push(r.value,r.done)}catch(e){t.push('reject',e===marker,e.message)}"
      : "await g.return(p).then(r=>t.push(r.value,r.done),e=>t.push('reject',e===marker,e.message));"}
    t.push((await g.next()).done);return t`;
  const expected = state === "yield" ? ["constructor", "catch", true, "broken", "finally", 7, true, true]
    : [...(state === "completed" ? ["finally"] : []), "constructor", "reject", true, "broken", true];
  expect(await runInNewContext(`(async()=>{${source}})()`)).toEqual(expected);
  const original = await run(source);
  expect(original).toMatchObject({ ok: true, returnValue: expected });
  expect(await run(source, { snapshot: JSON.parse(await dump(original)) }))
    .toMatchObject({ ok: true, returnValue: expected });
});

it("does not turn a fatal return-constructor budget failure into a guest throw", async () => {
  const trace: unknown[] = [];
  const source = `const p=Promise.resolve(1);Object.defineProperty(p,'constructor',{get(){while(true){}}});
    async function* f(){try{yield 1}catch(e){note('catch');return 7}finally{note('finally')}}
    const g=f();await g.next();try{await g.return(p)}catch(e){note('outer')}`;
  await expect(run(source, { budget: new Budget({ maxSteps: 1000 }), bindings: { note: (value: unknown) => trace.push(value) } }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  expect(trace).toEqual([]);
});

it("preserves return rejection ownership after restoring a pending host gate", async () => {
  const source = `const t=[];const marker=new Error('broken');const p=Promise.resolve(42);
    Object.defineProperty(p,'constructor',{get(){t.push('constructor');throw marker}});
    async function* f(){try{yield 1}catch(e){t.push('catch',e===marker,e.message);return 7}finally{t.push('finally')}}
    const g=f();await g.next();await wait();const r=await g.return(p);t.push(r.value,r.done);return t`;
  const expected = ["constructor", "catch", true, "broken", "finally", 7, true];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const original = run(source, { bindings: {
    wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(pending) })
  } });
  let snapshot: ReturnType<typeof JSON.parse>;
  try { snapshot = JSON.parse(await dump(original)); }
  finally { release(); await original; }
  expect(await original).toMatchObject({ ok: true, returnValue: expected });
  expect(await run(source, { snapshot, bindings: {
    wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(Promise.resolve()) })
  } })).toMatchObject({ ok: true, returnValue: expected });
});
