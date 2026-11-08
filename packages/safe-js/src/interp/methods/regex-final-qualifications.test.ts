import { assert, describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";

describe("separate unresolved string qualifications, not STR-02 readiness gates", () => {
  it.each([
    { issue: "ARRAYOWN match metadata access", source: 'return /a/.exec("a").index;' },
    { issue: "regex metadata own-key order", source: 'return Object.keys(/a/.exec("a"));' },
    { issue: "STR-03 numeric substitution", source: 'return "a".replace(/(a)/, "$10");' },
    {
      issue: "STR-03 context substitution",
      source: `return "abc".replace(/b/, ${JSON.stringify("$`-$'")});`
    },
    {
      issue: "STR-04 cursor state",
      source:
        'const regex = /a/g; regex.lastIndex = 2; const all = [..."aba".matchAll(regex)].map(match => match[0]); const matched = "aba".match(regex); return { all, matched, lastIndex: regex.lastIndex };'
    },
    { issue: "undefined split capture control", source: 'return "ab".split(/(a)|(b)/);' },
    {
      issue: "STR-05 zero-width split with undefined captures",
      source: 'return "ab".split(/(a)?/);'
    }
  ])("preserves native expectations for $issue", async ({ source }) => {
    const expected = new Function(source)();
    const actual = await run(source, { modules: {}, budget: new Budget({ maxSteps: 5_000 }) });
    assert(actual.ok);
    expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
  });
});
