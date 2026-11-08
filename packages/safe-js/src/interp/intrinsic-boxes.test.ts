import { types } from "node:util";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { decodeReplayData, encodeReplayData } from "../snapshot/replay-data.js";
import { Budget } from "./budget.js";
import { boxedValue, createSandboxBox, isSandboxBox, nativeBoxedValue, primitiveReceiver } from "./boxed.js";
import { createIntrinsicBox, registerIntrinsicObject, releaseObjectPrototype } from "./object-model.js";
import { deepCopyFromSandbox, deepCopyToSandbox, measureSandboxData, reconcileCompiledValues, type SandboxObject } from "./values.js";

it.each([0, -0, NaN, Infinity, -Infinity, "", "ab😀", false, true])(
  "preserves intrinsic box payload, aliases and charges across copying: %s", primitive => {
    const value = createIntrinsicBox(primitive);
    const plain = createSandboxBox(primitive);
    value.self = value;
    plain.self = plain;
    expect(isSandboxBox(value)).toBe(true);
    expect(boxedValue(value)).toBe(primitive);
    expect(nativeBoxedValue(value)).toBe(primitive);
    expect(measureSandboxData([value, value])).toBe(measureSandboxData([plain, plain]));
    const copy = deepCopyFromSandbox([value, value]) as object[];
    expect(copy[0]).toBe(copy[1]);
    expect(types.isBoxedPrimitive(copy[0])).toBe(true);
    expect(nativeBoxedValue(copy[0])).toBe(primitive);
    expect((copy[0] as SandboxObject).self).toBe(copy[0]);
    const imported = deepCopyToSandbox(copy) as SandboxObject[];
    expect(imported[0]).toBe(imported[1]);
    expect(boxedValue(imported[0]!)).toBe(primitive);
    expect(imported[0]!.self).toBe(imported[0]);
    const replayed = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData([value, value])))) as SandboxObject[];
    expect(replayed[0]).toBe(replayed[1]);
    expect(boxedValue(replayed[0]!)).toBe(primitive);
    expect(replayed[0]!.self).toBe(replayed[0]);
  }
);

it("keeps string index descriptors immutable and rejects unowned proxy brands", () => {
  const value = createIntrinsicBox("ab");
  expect(Object.getOwnPropertyDescriptor(value, "0")).toEqual({value: "a", writable: false, enumerable: true, configurable: false});
  expect(Reflect.defineProperty(value, "0", {value: "x"})).toBe(false);
  expect(Reflect.deleteProperty(value, "length")).toBe(false);
  const proxy = new Proxy(value, {});
  expect(isSandboxBox(proxy)).toBe(false);
  expect(nativeBoxedValue(proxy)).toBeUndefined();
  expect(() => primitiveReceiver(proxy, "string")).toThrow(TypeError);
  expect(() => deepCopyToSandbox(proxy)).toThrow(/proxy/);
});

it.each([undefined, null, {}, Symbol("unsupported"), 1n])("rejects unsupported tracked box payloads: %s", value => {
  expect(() => createIntrinsicBox(value as number)).toThrow(TypeError);
});

it("remeasures descendants of a cached intrinsic box under quotas", () => {
  const budget = new Budget({dataSize: 200});
  const value = createIntrinsicBox(0);
  registerIntrinsicObject(budget, value, false);
  const nested = {text: "small"};
  value.extra = nested;
  try {
    reconcileCompiledValues(budget, []);
    reconcileCompiledValues(budget, []);
    nested.text = "x".repeat(400);
    expect(() => reconcileCompiledValues(budget, [])).toThrow(expect.objectContaining({code: "budgetExceeded", budget: "dataSize"}));
  } finally { releaseObjectPrototype(budget); }
});

it("keeps owned boxed backing and payload metadata away from later native hooks", () => {
  const object = Object;
  const setPrototypeOf = Object.setPrototypeOf;
  const set = WeakMap.prototype.set;
  const add = WeakSet.prototype.add;
  const exposed: unknown[] = [];
  let value: ReturnType<typeof createIntrinsicBox>;
  try {
    globalThis.Object = new Proxy(object, {apply(target, receiver, args) {
      const result = Reflect.apply(target, receiver, args);
      exposed.push(result);
      return result;
    }});
    object.setPrototypeOf = (target, prototype) => { exposed.push(target); return setPrototypeOf(target, prototype); };
    WeakMap.prototype.set = function(key, data) { exposed.push(this, key, data); return set.call(this, key, data); };
    WeakSet.prototype.add = function(key) { exposed.push(this, key); return add.call(this, key); };
    value = createIntrinsicBox("private");
  } finally {
    globalThis.Object = object;
    object.setPrototypeOf = setPrototypeOf;
    WeakMap.prototype.set = set;
    WeakSet.prototype.add = add;
  }
  expect(exposed).toEqual([]);
  expect(boxedValue(value!)).toBe("private");
});

it.each(["String", "Number", "Boolean"])("keeps the %s prototype brand and structured clone behavior", async name => {
  const source = `const prototype=${name}.prototype;const copy=structuredClone(prototype);const results=[prototype.valueOf(),copy.valueOf(),Object.getPrototypeOf(copy)===prototype,Object.prototype.toString.call(prototype)];try{prototype.valueOf.call(Object.create(prototype))}catch(error){results.push(error.name)}try{prototype.valueOf.call(new Proxy(prototype,{}))}catch(error){results.push(error.name)}return results;`;
  const primitive = name === "String" ? "" : name === "Number" ? 0 : false;
  expect(await run(source)).toMatchObject({ok: true, returnValue: [primitive, primitive, true, `[object ${name}]`, "TypeError", "TypeError"]});
});
