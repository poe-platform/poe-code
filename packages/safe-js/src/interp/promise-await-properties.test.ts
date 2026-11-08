import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { Budget } from "./budget.js";

it.each([
  `let calls=0;const value=Promise.resolve(42);
   Object.defineProperty(value,"constructor",{get(){calls++;return Promise}});
   await value;return calls;`,
  `let calls=0;class Child extends Promise {then(a,b){calls++;return super.then(a,b)}}
   await Child.resolve(42);return calls;`,
  `const value=Promise.resolve(42);Object.defineProperty(value,"constructor",{get(){throw 17}});
   try {await value;return false}catch(error){return error===17}`,
  `const value=Promise.resolve(42);Object.setPrototypeOf(value,null);return (await value)===value;`,
  `const value=Promise.resolve(42);Object.defineProperty(value,"then",{get(){throw 17}});
   return await value;`,
  `const value=Promise.resolve(42);value.constructor=undefined;
   Object.defineProperty(value,"then",{get(){throw 17}});
   try {await value;return false}catch(error){return error===17}`,
  `let calls=0;const value=Promise.resolve(42);value.constructor=undefined;
   value.then=function(resolve){calls++;resolve(17)};return (await value)===17 && calls===1;`,
  `class Child extends Promise {};const value=Child.resolve(42);
   Promise.resolve=function(){throw 17};return await value;`,
  `let calls=0;const value=Promise.resolve(42);
   Object.defineProperty(Promise.prototype,"constructor",{get(){if(this===value)calls++;return Promise}});
   await value;return calls;`
])("matches native await property observations: %s", async source => {
  const expected = await runInNewContext(`(async()=>{${source}})()`);
  expect((await run(source)).returnValue).toEqual(expected);
});

it.each(["pending", "completed"])("preserves await property observations across %s replay", async mode => {
  const source = `let calls=0;class Child extends Promise {then(a,b){calls++;return super.then(a,b)}}
    const value=Child.resolve(42);const answer=await value;return answer===42 && calls===1;`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: true });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: true });
  } finally { await completed; }
});

it("cancels a subclass await whose custom then never settles", async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pending = run(`class Child extends Promise {then(){entered()}}
    return await Child.resolve(42);`, { signal: controller.signal, bindings: { entered } });
  const outcome = pending.catch(error => error);
  await ready;
  controller.abort(new Error("stop subclass await"));
  expect(await outcome).toMatchObject({ message: "stop subclass await" });
});

it("keeps budget failures in awaited constructor getters fatal", async () => {
  await expect(run(`const value=Promise.resolve(42);
    Object.defineProperty(value,"constructor",{get(){while(true){}}});
    try {await value}catch(error){return "swallowed"}`, { budget: new Budget({ maxSteps: 100 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded" });
});
