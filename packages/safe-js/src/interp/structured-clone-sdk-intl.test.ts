import { expect, it } from "vitest";
import { run } from "../run.js";
import { cloneSandboxValue } from "./values.js";

it.each([
  ["Locale", "'en'"],
  ["Collator", "'en'"],
  ["DateTimeFormat", "'en'"],
  ["DisplayNames", "'en',{type:'language'}"],
  ["ListFormat", "'en'"],
  ["NumberFormat", "'en'"],
  ["PluralRules", "'en'"],
  ["RelativeTimeFormat", "'en'"],
  ["Segmenter", "'en'"],
  ["DurationFormat", "'en'"]
])("rejects Intl.%s private state in SDK structured cloning", async (name, args) => {
  for (const removePrototype of [false, true]) {
    const result = await run(`const value=new Intl.${name}(${args});
      ${removePrototype ? "Object.setPrototypeOf(value,null);" : ""}
      return value;`);
    if (!result.ok) throw new Error("Failed to create Intl guest value");
    for (const input of [result.returnValue, { value: result.returnValue }]) {
      expect(() => cloneSandboxValue(input, { structuredClone: true }))
        .toThrow(expect.objectContaining({ name: "DataCloneError" }));
    }
  }
});

it("rejects a Segmenter segments object by private brand", async () => {
  const result = await run("return new Intl.Segmenter('en').segment('hello world')");
  if (!result.ok) throw new Error("Failed to create segments");
  expect(() => cloneSandboxValue(result.returnValue, { structuredClone: true }))
    .toThrow(expect.objectContaining({ name: "DataCloneError" }));
});

it("clones ordinary records inheriting an Intl prototype", async () => {
  const result = await run("const value=Object.create(Intl.NumberFormat.prototype);value.answer=42;return value");
  if (!result.ok) throw new Error("Failed to create ordinary record");
  const copy = cloneSandboxValue(result.returnValue, { structuredClone: true });
  expect(copy).toEqual({ answer: 42 });
  expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
});
