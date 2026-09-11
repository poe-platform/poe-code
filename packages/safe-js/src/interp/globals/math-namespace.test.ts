import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each(["E", "LN2", "LN10", "LOG2E", "LOG10E", "PI", "SQRT1_2", "SQRT2"])(
  "matches the native Math.%s constant descriptor",
  async name => {
    const result = await run(`return Object.getOwnPropertyDescriptor(Math, ${JSON.stringify(name)})`);
    expect(result.returnValue).toEqual(Object.getOwnPropertyDescriptor(Math, name));
  }
);

it.each(["abs", "random", "max"])("makes Math.%s non-enumerable", async name => {
  const result = await run(`const d = Object.getOwnPropertyDescriptor(Math, ${JSON.stringify(name)}); return [d.enumerable, d.writable, d.configurable]`);
  const descriptor = Object.getOwnPropertyDescriptor(Math, name)!;
  expect(result.returnValue).toEqual([descriptor.enumerable, descriptor.writable, descriptor.configurable]);
});

it("does not enumerate standard Math properties", async () => {
  expect((await run("return Object.keys(Math)")).returnValue).toEqual(Object.keys(Math));
});

it("provides the standard Math string tag descriptor", async () => {
  expect((await run("return Object.getOwnPropertyDescriptor(Math, Symbol.toStringTag)")).returnValue)
    .toEqual(Object.getOwnPropertyDescriptor(Math, Symbol.toStringTag));
});

it("uses the Math tag in Object.prototype.toString", async () => {
  expect((await run("return Object.prototype.toString.call(Math)")).returnValue)
    .toBe(Object.prototype.toString.call(Math));
});

it("rejects changing or deleting Math constants", async () => {
  const result = await run(`const errors = [];
    try { Math.PI = 0; } catch (error) { errors.push(error.name); }
    try { delete Math.PI; } catch (error) { errors.push(error.name); }
    try { Object.defineProperty(Math, "PI", {value: 0}); } catch (error) { errors.push(error.name); }
    return [errors, Math.PI];`);
  expect(result.returnValue).toEqual([["TypeError", "TypeError", "TypeError"], Math.PI]);
});

it.each(["pending", "completed"])("preserves modified Math namespace in %s checkpoints", async mode => {
  const source = `const alias = Math;
    Object.defineProperty(Math, Symbol.toStringTag, {value: "CustomMath"});
    Math.abs = () => 7; delete Math.max; Math.extra = 9;
    await 0;
    return [alias === Math, Object.keys(Math), Math.abs(-1), typeof Math.max,
      Object.prototype.toString.call(Math), Object.getOwnPropertyDescriptor(Math, "PI")];`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), {source});
    const result = await completed;
    expect(result).toMatchObject({ok: true, returnValue: [true, ["extra"], 7, "undefined",
      "[object CustomMath]", Object.getOwnPropertyDescriptor(Math, "PI")]});
    expect(await run(source, {snapshot})).toMatchObject({ok: true, returnValue: result.returnValue});
    expect(await run(source, {snapshot: result.snapshot})).toMatchObject({ok: true, returnValue: result.returnValue});
  } finally { await completed; }
});
