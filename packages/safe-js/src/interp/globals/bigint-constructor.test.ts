import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it("keeps the constructor prototype descriptor immutable", async () => {
  expect((await run(`const d = Object.getOwnPropertyDescriptor(BigInt, "prototype");
    return [d.value === BigInt.prototype, d.writable, d.enumerable, d.configurable];`
  )).returnValue).toEqual([true, false, false, false]);
});

it("allows BigInt heritage and use as newTarget without allowing construction", async () => {
  expect((await run(`
    class Derived extends BigInt {}
    const object = Reflect.construct(Object, [], BigInt);
    return [Object.getPrototypeOf(Derived) === BigInt,
      Object.getPrototypeOf(Derived.prototype) === BigInt.prototype,
      Object.getPrototypeOf(object) === BigInt.prototype];
  `)).returnValue).toEqual([true, true, true]);
});

it("rejects direct, derived and reflected construction before coercion", async () => {
  expect((await run(`
    class Derived extends BigInt {}
    const log = [];
    const value = new Proxy({}, {get(target, key) { log.push(String(key)); }});
    const errors = [];
    for (const construct of [() => new BigInt(value), () => new Derived(value),
      () => Reflect.construct(BigInt, [value])]) {
      try { construct(); errors.push(false); }
      catch (error) { errors.push(error instanceof TypeError); }
    }
    return [errors, log];
  `)).returnValue).toEqual([[true, true, true], []]);
});

it("keeps call coercion, receiver brands and host prototypes isolated", async () => {
  const keys = Reflect.ownKeys(BigInt.prototype);
  expect((await run(`
    const log = [];
    const value = BigInt({[Symbol.toPrimitive](hint) { log.push(hint); return 7; }});
    BigInt.prototype.guestMarker = 1;
    let invalidBrand = false;
    try { BigInt.prototype.valueOf.call({}); } catch (error) {
      invalidBrand = error instanceof TypeError;
    }
    return [value === 7n, log, invalidBrand, Object(7n).valueOf() === 7n];
  `)).returnValue).toEqual([true, ["number"], true, true]);
  expect(Reflect.ownKeys(BigInt.prototype)).toEqual(keys);
});

it("preserves derived constructor rejection through pending and completed replay", async () => {
  const source = `class Derived extends BigInt {};
    await 0;
    try { new Derived(1); return false; }
    catch (error) { return error instanceof TypeError && Object.getPrototypeOf(Derived) === BigInt; }`;
  const pending = run(source);
  const settled = pending.catch(error => error);
  try {
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await settled).toMatchObject({ ok: true, returnValue: true });
    const replay = run(source, { snapshot });
    expect(await replay).toMatchObject({ ok: true, returnValue: true });
    const completed = restore(JSON.parse(await dump(replay)), { source });
    expect(await run(source, { snapshot: completed })).toMatchObject({ ok: true, returnValue: true });
  } finally { await settled; }
});
