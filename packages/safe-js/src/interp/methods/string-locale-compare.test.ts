import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createSandboxClosure, isSandboxClosure } from "../values.js";
import { getStringMember } from "./string.js";

describe("String#localeCompare", () => {
  it.each([
    '"alpha".localeCompare("beta")',
    '"beta".localeCompare("alpha")',
    '"same".localeCompare("same")',
    '"".localeCompare("")',
    '"ä".localeCompare("z", "de")',
    '"ä".localeCompare("z", "sv")',
    '"é".localeCompare("e\\u0301", "fr")',
    '"a".localeCompare("A", "en", { sensitivity: "base" })',
    '"a".localeCompare("A", "en", { sensitivity: "case", caseFirst: "upper" })',
    '"a".localeCompare("á", "en", { sensitivity: "accent" })',
    '"a".localeCompare("A", "en", { sensitivity: "variant", caseFirst: "lower" })',
    '"a".localeCompare("A", "en", { caseFirst: "false" })',
    '"item2".localeCompare("item10", ["en-US", "de"], { numeric: true })',
    '"item2".localeCompare("item10", "en", { numeric: false })',
    '"a-b".localeCompare("ab", "en", { ignorePunctuation: true })',
    '"a-b".localeCompare("ab", "en", { ignorePunctuation: false })',
    '"ä".localeCompare("a", "de", { usage: "search", sensitivity: "base" })',
    '"ä".localeCompare("ae", "de", { collation: "phonebk" })',
    '"x2".localeCompare("x10", "en-u-kn-true")',
    '"x2".localeCompare("x10", "en-u-kn-true", { numeric: false })',
    '"a".localeCompare("b", { 0: "en", length: 1 }, { localeMatcher: "lookup" })',
    '"a".localeCompare("b", [ , "en"], {})',
    '"a".localeCompare("b", [], { usage: "sort", localeMatcher: "best fit" })',
    '"a".localeCompare("b", undefined, undefined)',
    '"a".localeCompare("b", 7, true)',
    '"42".localeCompare(42)',
    '"null".localeCompare(null)',
    '"undefined".localeCompare()',
    '"true".localeCompare(true)',
    '"1,2".localeCompare([1, 2])'
  ])("matches the native result for %s", async (expression) => {
    const native: unknown = runInNewContext(expression, {}, { timeout: 1000 });
    expect(typeof native).toBe("number");
    expect(await run(`return ${expression};`)).toMatchObject({
      ok: true,
      returnValue: native
    });
  });

  it.each([
    '["b", "bad_locale"]',
    '["b", ["en", 1]]',
    '["b", null]',
    '["b", "en", null]',
    '["b", "en", { sensitivity: "invalid" }]',
    '["b", "en", { caseFirst: "invalid" }]',
    '["b", "en", { usage: "invalid" }]',
    '["b", "en", { localeMatcher: "invalid" }]',
    '["b", "en", { collation: "bad_value" }]'
  ])("preserves the native error for %s", async (argumentsSource) => {
    const source = `try {
      "a".localeCompare(...${argumentsSource});
      return { caught: false };
    } catch (error) {
      return { caught: true, name: error.name, message: error.message };
    }`;
    const native: unknown = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1000 });
    expect(native).toMatchObject({ caught: true });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: native });
  });

  it("exposes a sandbox intrinsic and returns only the native numeric result", async () => {
    const member = getStringMember("ä", "localeCompare", new Budget());
    expect(isSandboxClosure(member)).toBe(true);
    if (!isSandboxClosure(member)) throw new Error("Missing localeCompare intrinsic");
    expect(member.sandbox).toBe(true);
    expect(await member.call(["z", "sv"])).toBe("ä".localeCompare("z", "sv"));
  });

  it("preserves the native intrinsic arity through extraction and binding", async () => {
    const member = getStringMember("a", "localeCompare", new Budget());
    if (!isSandboxClosure(member)) throw new Error("Missing localeCompare intrinsic");
    expect(member.length).toBe(String.prototype.localeCompare.length);
    expect(
      await run(
        'const compare = "a".localeCompare; return [compare.length, compare.bind(null, "b").length];'
      )
    ).toMatchObject({
      ok: true,
      returnValue: [String.prototype.localeCompare.length, "a".localeCompare.bind("a", "b").length]
    });
  });

  it("preserves extracted method behavior, evaluation order and ignored arguments", async () => {
    const source = `const trace = [];
      const left = "item2";
      const options = { numeric: true };
      const compare = left.localeCompare.bind(left);
      const first = left.localeCompare(
        (trace.push("compare"), "item10"),
        (trace.push("locale"), "en"),
        (trace.push("options"), options),
        (trace.push("extra"), () => { throw Error("ignored"); })
      );
      return { first, second: compare("item10", "en", options), trace, numeric: options.numeric };
    `;
    const native: unknown = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: native });
  });

  it("uses options without invoking ignored callbacks or coercing boolean options", async () => {
    const source = `let calls = 0;
      const unused = () => { calls++; throw Error("unused"); };
      const result = "item2".localeCompare("item10", "en", {
        numeric: unused, ignorePunctuation: [], unrelated: unused
      });
      return { result, calls };
    `;
    const native: unknown = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: native });
  });

  it("keeps callback comparison conversion inside the existing sandbox boundary", async () => {
    let calls = 0;
    const closure = createSandboxClosure({
      name: "not-a-comparison-string",
      call: () => {
        calls++;
        return "b";
      }
    });
    const member = getStringMember("a", "localeCompare", new Budget());
    if (!isSandboxClosure(member)) throw new Error("Missing localeCompare intrinsic");
    expect(() => member.call([closure])).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it("passes only relevant data to native collation, not sandbox callback records", () => {
    const unused = createSandboxClosure({ name: "unused", call: () => "unused" });
    const member = getStringMember("item2", "localeCompare", new Budget());
    if (!isSandboxClosure(member)) throw new Error("Missing localeCompare intrinsic");
    const native = vi.spyOn(String.prototype, "localeCompare");
    try {
      member.call(["item10", "en", { numeric: unused, unrelated: unused }]);
      const forwarded = native.mock.calls.at(-1);
      expect(forwarded?.[2]?.numeric).toBe(true);
      expect(forwarded?.[2]).not.toHaveProperty("unrelated");
    } finally {
      native.mockRestore();
    }
  });

  it("validates locale syntax before converting option values", async () => {
    const source = `let calls = 0;
      try {
        "a".localeCompare("b", "en_US", { sensitivity: () => { calls++; return "base"; } });
        return { caught: false, calls };
      } catch (error) {
        return { caught: true, name: error.name, message: error.message, calls };
      }
    `;
    const native: unknown = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: native });
  });

  it("charges comparison string coercion to the string budget", () => {
    const member = getStringMember("a", "localeCompare", new Budget({ stringLength: 2 }));
    if (!isSandboxClosure(member)) throw new Error("Missing localeCompare intrinsic");
    expect(() => member.call([123])).toThrow("stringLength");
  });

  it("does not turn a fatal comparison budget error into a catchable error", async () => {
    await expect(
      run('try { return "a".localeCompare(123456789); } catch (error) { return "caught"; }', {
        budget: new Budget({ stringLength: 8 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
  });

  it("sorts the original comparator natively and preserves completed replay", async () => {
    const source = `const names = ["z", "ä", "a", "item10", "item2"];
      const options = { numeric: true, sensitivity: "base" };
      names.sort((left, right) => left.localeCompare(right, "de", options));
      return { names, options, comparison: "item2".localeCompare("item10", "de", options) };
    `;
    const native: unknown = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1000 });
    const execution = run(source);
    expect(await execution).toMatchObject({ ok: true, returnValue: native });
    const serialized = await dump(execution);
    expect(
      await run(source, { snapshot: restore(JSON.parse(serialized), { source }) })
    ).toMatchObject({ ok: true, returnValue: native });
  });

  it("keeps optional calls lazy and computed members equivalent", async () => {
    const source = `const trace = [];
      const missing = null;
      const skipped = missing?.localeCompare(trace.push("unexpected"));
      const compared = "a"["localeCompare"]((trace.push("compared"), "b"), "en");
      return { skipped, compared, trace };
    `;
    const native: unknown = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: native });
  });

  it("retains the existing bound-intrinsic model for extraction, call and apply", async () => {
    const source = `const compare = "a".localeCompare;
      return [compare("b", "en"), compare.call("z", "b", "en"), compare.apply("z", ["b", "en"])];
    `;
    const native = "a".localeCompare.bind("a");
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: [native("b", "en"), native.call("z", "b", "en"), native.apply("z", ["b", "en"])]
    });
  });

  it("rejects an uncaught invalid option through the public execution promise", async () => {
    await expect(
      run('return "a".localeCompare("b", "en", { sensitivity: "invalid" });')
    ).rejects.toMatchObject({
      name: "RangeError"
    });
  });

  it("anchors the proposed README example without relying on comparison magnitude", async () => {
    const source = `return [
      "a".localeCompare("b", "en") < 0,
      "same".localeCompare("same", "en") === 0,
      "10".localeCompare("2", "en", { numeric: true }) > 0
    ];`;
    expect(runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1000 })).toEqual([
      true,
      true,
      true
    ]);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: [true, true, true] });
  });
});
