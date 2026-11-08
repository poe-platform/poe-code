import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox } from "../values.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each(["new Child(resolve=>resolve(42))", "Child.resolve(42)"])("preserves subclass prototypes through %s", async expression => {
  const result = await run(`class Child extends Promise {};
    const value=${expression};
    return value instanceof Child && Object.getPrototypeOf(value)===Child.prototype && (await value)===42`);
  expect(result.returnValue === true).toBe(true);
});

it.each([
  `const value=Child.reject(42); return [value instanceof Child, await value.catch(x=>x)];`,
  `const value=Child.all([1,2]); return [value instanceof Child, await value];`,
  `const value=Child.race([42]); return [value instanceof Child, await value];`,
  `const value=Child.any([42]); return [value instanceof Child, await value];`,
  `const value=Child.allSettled([42]); return [value instanceof Child, await value];`,
  `const value=Child.resolve(42); return [Child.resolve(value)===value, Promise.resolve(value)!==value];`,
  `const value=Child.resolve(41).then(x=>x+1); return [value instanceof Child, await value];`,
  `const value=Child.resolve(42).finally(()=>undefined); return [value instanceof Child, await value];`,
  `class Grandchild extends Child {};
   const value=Grandchild.resolve(42); return [value instanceof Grandchild,value instanceof Child,await value];`
])("matches native inherited Promise operations: %s", async body => {
  const source = `class Child extends Promise {}; ${body}`;
  const expected = await new Function(`return (async()=>{${source}})()`)();
  const result = await run(source);
  expect(deepCopyFromSandbox(result.returnValue)).toEqual(expected);
});

it("initializes subclass fields and uses its species override", async () => {
  const result = await run(`class Child extends Promise {
    label = "child";
    constructor(executor) { super(executor); this.target = new.target; }
    static get [Symbol.species]() { return Promise; }
  }
  const value = Child.resolve(42);
  const chained = value.then(x => x);
  return value.label === "child" && value.target === Child &&
    !(chained instanceof Child) && chained instanceof Promise && (await chained) === 42;`);
  expect(result.returnValue).toBe(true);
});

it.each(["pending", "completed"])("preserves subclass promises across %s replay", async mode => {
  const source = `class Child extends Promise { label = "child"; }
    const value=Child.resolve(41); await 0;
    const next=value.then(x=>x+1);
    return value instanceof Child && next instanceof Child &&
      value.label==="child" && (await next)===42;`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: true });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: true });
  } finally { await completed; }
});

it("assimilates subclass promises returned from thenables and reactions", async () => {
  const result = await run(`class Child extends Promise {};
    const fromThenable=Promise.resolve({then(resolve){resolve(Child.resolve(20))}});
    const fromReaction=Promise.resolve(0).then(()=>Child.resolve(22));
    return (await fromThenable)+(await fromReaction);`);
  expect(result.returnValue).toBe(42);
});
