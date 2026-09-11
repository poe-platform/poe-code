import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it("exposes native Promise method arity", async () => {
  const result = await run(`return [Promise.resolve.length,Promise.reject.length,Promise.all.length,Promise.prototype.then.length]`);
  expect(result.returnValue).toEqual([1, 1, 1, 2]);
});

it.each([
  ["Promise.all", "all", 1],
  ["Promise.race", "race", 1],
  ["Promise.allSettled", "allSettled", 1],
  ["Promise.any", "any", 1],
  ["Promise.resolve", "resolve", 1],
  ["Promise.reject", "reject", 1],
  ["Promise.prototype.then", "then", 2],
  ["Promise.prototype.catch", "catch", 1],
  ["Promise.prototype.finally", "finally", 1]
])("exposes native descriptors for %s", async (expression, name, length) => {
  const source = `const method=${expression};
    const name=Object.getOwnPropertyDescriptor(method,"name");
    const length=Object.getOwnPropertyDescriptor(method,"length");
    return [method.name,method.length,name?.writable,name?.enumerable,name?.configurable,
      length?.writable,length?.enumerable,length?.configurable,Object.hasOwn(method,"prototype")]`;
  const expected = [name, length, false, false, true, false, false, true, false];
  expect(new Function(source)()).toEqual(expected);
  expect((await run(source)).returnValue).toEqual(expected);
});

it.each(["Promise.resolve", "Promise.prototype.then"])("allows metadata redefinition without changing %s behavior", async expression => {
  const source = `const method=${expression};
    Object.defineProperty(method,"length",{value:42});
    Object.defineProperty(method,"name",{value:"custom"});
    const value=await Promise.resolve(1).then(x=>x+1);
    return [method.length,method.name,value]`;
  expect((await run(source)).returnValue).toEqual([42, "custom", 2]);
});

it.each(["pending", "completed"])("preserves method metadata across %s checkpoints", async mode => {
  const source = `Object.defineProperty(Promise.resolve,"length",{value:42});
    Object.defineProperty(Promise.prototype.then,"name",{value:"custom"});
    await 0;
    return [Promise.resolve.length,Promise.prototype.then.name,await Promise.resolve(1).then(x=>x+1)]`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: [42, "custom", 2] });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: [42, "custom", 2] });
  } finally { await completed; }
});
