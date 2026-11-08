import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";
import { getSandboxPrototype } from "../object-model.js";

it.each(["Array()", "Array(2)", "Array('x')", "Array(3,5)", "new Array(2)", "new Array('x')", "new Array(3,5)"])(
  "preserves the originating realm for SDK construction: %s", async expression => {
    const native = runInNewContext(`(()=>{const value=${expression};return Object.getPrototypeOf(value)===Array.prototype})()`);
    expect(native).toBe(true);
    const result = (await run(`return [()=>${expression},Array.prototype]`)).returnValue;
    const other = (await run("return Object.getPrototypeOf")).returnValue;
    if (!Array.isArray(result) || !isSandboxClosure(result[0]) || !isSandboxClosure(other)) throw new Error("Expected SDK exports");
    const context = { stack: [], thisValue: undefined };
    const value = await result[0].call([], context);
    expect(await other.call([value], context)).toBe(result[1]);
    if (!Array.isArray(value)) throw new Error("Expected constructed array");
    expect(getSandboxPrototype(value)).toBe(result[1]);
    const copy = deepCopyFromSandbox(value);
    expect(Object.getOwnPropertyDescriptors(copy as object)).toEqual(
      Object.getOwnPropertyDescriptors(runInNewContext(expression))
    );
  }
);

it("keeps later originating prototype mutations on constructed arrays", async () => {
  const result = (await run("const value=new Array(2);return [value,Array.prototype,()=>{Array.prototype.marker=7}]")).returnValue;
  if (!Array.isArray(result) || !Array.isArray(result[0]) || !isSandboxClosure(result[2])) throw new Error("Expected SDK exports");
  await result[2].call([], { stack: [], thisValue: undefined });
  expect(getSandboxPrototype(result[0])).toBe(result[1]);
  expect(() => deepCopyFromSandbox(result[0])).toThrow();
});

it("preserves custom construction prototypes", async () => {
  const result = (await run("const prototype={marker:7};function Target(){}Target.prototype=prototype;return [Reflect.construct(Array,[2],Target),prototype]")).returnValue;
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("Expected SDK exports");
  expect(getSandboxPrototype(result[0])).toBe(result[1]);
  expect(() => deepCopyFromSandbox(result[0])).toThrow();
});

it.each([-1, 1.5, 4294967296])("keeps invalid array length rejection: %s", async length => {
  expect(() => new Array(length)).toThrow(RangeError);
  await expect(run(`return Array(${length})`)).rejects.toMatchObject({ name: "RangeError" });
});
