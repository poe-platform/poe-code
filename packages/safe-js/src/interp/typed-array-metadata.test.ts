import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { isNumericTypedArray, typedArrayProperties } from "./typed-array.js";
import { measureSandboxData } from "./values.js";

it("accounts buffer views without enumerating element keys", async () => {
  const ownKeys = Reflect.ownKeys;
  const spy = vi.spyOn(Reflect, "ownKeys").mockImplementation((value) => {
    if (isNumericTypedArray(value)) throw new Error("Accounting enumerated typed-array indices");
    return ownKeys(value);
  });
  try {
    expect(
      await run(
        "const buffer=new ArrayBuffer(65536); const bytes=new Uint8Array(buffer); const words=new Int32Array(buffer); bytes[0]=42; return [words[0], bytes.buffer===words.buffer, ArrayBuffer.isView(bytes)];"
      )
    ).toMatchObject({ ok: true, returnValue: [42, true, true] });
  } finally {
    spy.mockRestore();
  }
});

it("tracks native and guest metadata mutation without invoking getters", async () => {
  const result = await run(
    'const value=new Uint8Array(2); value.first="a"; Object.defineProperty(value,"hidden",{value:"b",writable:true,configurable:true}); const key=Symbol("tag"); Reflect.defineProperty(value,key,{value:"c",writable:true,configurable:true}); delete value.first; value.first="d"; return value;'
  );
  expect(result.ok).toBe(true);
  if (!result.ok || !isNumericTypedArray(result.returnValue))
    throw new Error("Expected a typed array");
  const value = result.returnValue;
  expect(typedArrayProperties(value).map(([key]) => key)).toEqual([
    "hidden",
    "first",
    ...Object.getOwnPropertySymbols(value)
  ]);
  const before = measureSandboxData([value]);
  Object.defineProperty(value, "hidden", { value: "b".repeat(401) });
  expect(measureSandboxData([value]) - before).toBe(400);
  const getter = vi.fn(() => "unread");
  Object.defineProperty(value, "accessor", { get: getter, configurable: true });
  measureSandboxData([value]);
  expect(getter).not.toHaveBeenCalled();
  Reflect.deleteProperty(value, "hidden");
  expect(typedArrayProperties(value).map(([key]) => key)).toEqual([
    "first",
    "accessor",
    ...Object.getOwnPropertySymbols(value)
  ]);
  Object.preventExtensions(value);
  expect(Reflect.defineProperty(value, "rejected", { value: "x" })).toBe(false);
  expect(typedArrayProperties(value).some(([key]) => key === "rejected")).toBe(false);
});

it("keeps guest reflection, descriptor changes and canonical numeric keys native", async () => {
  const source =
    'const value=new Uint8Array([1,2]); value["01"]=3; value["1.0"]=4; value["-0"]=5; value["NaN"]=6; const key=Symbol("s"); value[key]=7; Object.defineProperty(value,"hidden",{value:8}); return [Object.keys(value),Reflect.ownKeys(value).map(k=>typeof k==="symbol"?k.description:k),Object.getOwnPropertyDescriptor(value,"0"),value[0],value["NaN"]];';
  expect(await run(source)).toMatchObject({ ok: true, returnValue: Function(source)() });
});

it("keeps SDK native methods and callbacks from exposing an untracked target", async () => {
  const result = await run("return new Uint8Array([1,2]);");
  if (!result.ok || !isNumericTypedArray(result.returnValue))
    throw new Error("Expected typed array");
  const value = result.returnValue as Uint8Array<ArrayBuffer> & { payload?: string };
  expect(value.fill(3)).toBe(value);
  value.forEach((_entry, _index, receiver) => {
    expect(receiver).toBe(value);
    (receiver as typeof value).payload = "x".repeat(400);
  });
  expect(typedArrayProperties(value).map(([key]) => key)).toEqual(["payload"]);
  expect(Array.from(value)).toEqual([3, 3]);
});

it("preserves borrowed native methods' receiver", async () => {
  const result = await run("return new Uint8Array([1,2]);");
  if (!result.ok || !isNumericTypedArray(result.returnValue))
    throw new Error("Expected typed array");
  const value = result.returnValue as Uint8Array;
  const other = new Uint8Array(2);
  expect(value.fill.call(other, 9)).toBe(other);
  expect(Array.from(other)).toEqual([9, 9]);
  expect(Array.from(value)).toEqual([1, 2]);
  expect(() => value.fill.call({}, 9)).toThrow(TypeError);
});

it("preserves SDK constructor and native method identity", async () => {
  const result = await run("return new Uint8Array([1,2]);");
  if (!result.ok || !isNumericTypedArray(result.returnValue))
    throw new Error("Expected typed array");
  const value = result.returnValue;
  expect(value.constructor).toBe(Uint8Array);
  expect(value.values).toBe(value.values);
  expect(value[Symbol.iterator]).toBe(value.values);
});
