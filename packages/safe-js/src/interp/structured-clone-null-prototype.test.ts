import { expect, it } from "vitest";
import { run } from "../run.js";
import { cloneSandboxValue } from "./values.js";

it("normalizes null-prototype SDK records only during structured cloning", () => {
  const value = Object.assign(Object.create(null), { answer: 42 });
  value.self = value;
  const native = structuredClone(value);
  expect(Object.getPrototypeOf(native)).toBe(Object.prototype);
  const copy = cloneSandboxValue(value, { structuredClone: true }) as typeof value;
  expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
  expect(copy.self).toBe(copy);
  expect(copy.answer).toBe(42);
  expect(Object.getPrototypeOf(cloneSandboxValue(value))).toBeNull();
});

it("normalizes null-prototype guest records and preserves cycles", async () => {
  const source = `const value=Object.create(null);value.answer=42;value.self=value;
    const copy=structuredClone(value);
    return [Object.getPrototypeOf(copy)===Object.prototype,copy.self===copy,copy.answer];`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: Function(source)() });
});
