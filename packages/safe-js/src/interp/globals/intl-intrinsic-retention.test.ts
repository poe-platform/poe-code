import { expect, it } from "vitest";
import { Budget } from "../budget.js";
import { defineOwnDataProperty, isSandboxClosure, measureSandboxData, type SandboxObject } from "../values.js";
import { createIntlGlobal } from "./intl.js";
import { createDateGlobal } from "./date.js";
import { createObjectArrayGlobals } from "./object-array.js";
import { resolveIntrinsicIdentity } from "../intrinsics.js";

it.each(["Locale", "Collator", "NumberFormat", "ListFormat", "RelativeTimeFormat", "DisplayNames", "DateTimeFormat", "PluralRules", "Segmenter", "DurationFormat"])(
  "accounts for retained mutations on Intl.%s.prototype and its methods",
  name => {
    const budget = new Budget();
    createObjectArrayGlobals({ budget });
    const date = createDateGlobal({ budget });
    const now = date.properties!.now;
    if (!isSandboxClosure(now)) throw new Error("Expected Date.now");
    const intl = createIntlGlobal(budget, now);
    const constructor = intl[name];
    if (!isSandboxClosure(constructor)) throw new Error("Expected an Intl constructor");
    const prototype = constructor.properties!.prototype as SandboxObject;
    const method = Object.values(Object.getOwnPropertyDescriptors(prototype))
      .map(descriptor => descriptor.value)
      .find(value => isSandboxClosure(value) && value !== constructor);
    if (!isSandboxClosure(method)) throw new Error("Expected an Intl prototype method");
    for (const target of [prototype, method.properties!]) {
      const baseline = measureSandboxData(budget.retainedValues());
      defineOwnDataProperty(target, "payload", "x".repeat(2000));
      expect(measureSandboxData(budget.retainedValues()) - baseline).toBe(2007);
      delete target.payload;
      expect(measureSandboxData(budget.retainedValues())).toBe(baseline);
    }
  }
);

it.each([
  ["%IntlSegmentsPrototype%", "containing"],
  ["%IntlSegmentIteratorPrototype%", "next"]
])("accounts for mutations on %s and its method", (name, methodName) => {
  const budget = new Budget();
  createObjectArrayGlobals({ budget });
  const date = createDateGlobal({ budget });
  const now = date.properties!.now;
  if (!isSandboxClosure(now)) throw new Error("Expected Date.now");
  createIntlGlobal(budget, now);
  const prototype = resolveIntrinsicIdentity(budget, JSON.stringify([name])) as SandboxObject;
  const method = prototype[methodName];
  if (!isSandboxClosure(method)) throw new Error("Expected segment method");
  for (const target of [prototype, method.properties!]) {
    const baseline = measureSandboxData(budget.retainedValues());
    defineOwnDataProperty(target, "payload", "x".repeat(2000));
    expect(measureSandboxData(budget.retainedValues()) - baseline).toBe(2007);
    delete target.payload;
    expect(measureSandboxData(budget.retainedValues())).toBe(baseline);
  }
});
