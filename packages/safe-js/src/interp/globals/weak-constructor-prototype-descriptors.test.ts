import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry"])(
  "%s preserves its read-only constructor prototype before and after replay", async name => {
    const source = `
      const constructor=${name}, original=constructor.prototype;
      await 0;
      const descriptor=Object.getOwnPropertyDescriptor(constructor,'prototype');
      return [descriptor.writable,descriptor.enumerable,descriptor.configurable,
        Reflect.set(constructor,'prototype',{}),
        Reflect.defineProperty(constructor,'prototype',{value:{}}),
        constructor.prototype===original];
    `;
    const expected = [false, false, false, false, false, true];
    expect(await runInNewContext(`(async()=>{${source}})()`)).toEqual(expected);
    const result = await run(source);
    expect(result).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: JSON.parse(await dump(result)) }))
      .toMatchObject({ ok: true, returnValue: expected });
  }
);

it("keeps ordinary function prototype properties writable", async () => {
  const source = `
    function Constructor() {}
    await 0;
    const replacement={};
    return [Object.getOwnPropertyDescriptor(Constructor,'prototype').writable,
      Reflect.set(Constructor,'prototype',replacement),
      Object.getPrototypeOf(new Constructor())===replacement];
  `;
  const expected = [true, true, true];
  expect(await runInNewContext(`(async()=>{${source}})()`)).toEqual(expected);
  const result = await run(source);
  expect(result).toMatchObject({ ok: true, returnValue: expected });
  expect(await run(source, { snapshot: JSON.parse(await dump(result)) }))
    .toMatchObject({ ok: true, returnValue: expected });
});
