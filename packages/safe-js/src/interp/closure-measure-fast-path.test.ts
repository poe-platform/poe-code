import { expect, it, vi } from "vitest";
import * as locales from "./intl-locale.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";
import { setSandboxPrototype } from "./object-model.js";

it("does not inspect unrelated Intl state when measuring a closure", () => {
  const closure = createSandboxClosure({call:()=>undefined,retainedValues:()=>["abc"]});
  const inspectLocale = vi.spyOn(locales,"isSandboxLocale");
  try {
    expect(measureSandboxData([closure])).toBe(4);
    expect(inspectLocale.mock.calls.filter(([value])=>value===closure)).toHaveLength(0);
  } finally {inspectLocale.mockRestore();}
});

it("retains prototype accounting when closure captures are ignored", () => {
  const closure = createSandboxClosure({guest:true,sandbox:true,call:()=>undefined,retainedValues:()=>["abc"]});
  const prototype = {word:"value"};
  setSandboxPrototype(closure,prototype);
  const baseline = 1+measureSandboxData([prototype]);
  const properties = measureSandboxData([closure.properties]);
  expect(measureSandboxData([closure])).toBe(baseline+properties+3);
  expect(measureSandboxData([closure],{ignoreClosureCaptures:true})).toBe(baseline+properties);
  expect(measureSandboxData([closure],{ignoreClosures:true})).toBe(baseline);
  expect(measureSandboxData([closure,prototype])).toBe(baseline+properties+3);
});
