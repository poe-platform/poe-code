import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createSandboxClosure, deepCopyToSandbox, isSandboxClosure } from "../values.js";
import { getStringMember } from "./string.js";

describe("independent localeCompare candidate validation", () => {
  it.each([
    '["a".localeCompare("b"), "b".localeCompare("a"), "x".localeCompare("x")]',
    '["".localeCompare(""), "undefined".localeCompare(), "null".localeCompare(null)]',
    '["42".localeCompare(42), "true".localeCompare(true), "1,2".localeCompare([1, 2])]',
    '["ä".localeCompare("z", "de"), "ä".localeCompare("z", "sv")]',
    '"ä".localeCompare("z", ["de", "en"] )',
    '["a".localeCompare("A", "en", { sensitivity: "base" }), "a".localeCompare("á", "en", { sensitivity: "accent" })]',
    '["a".localeCompare("A", "en", { sensitivity: "case" }), "a".localeCompare("A", "en", { sensitivity: "variant" })]',
    '["2".localeCompare("10", "en", { numeric: true }), "2".localeCompare("10", "en", { numeric: false })]',
    '["a".localeCompare("A", "en", { caseFirst: "upper" }), "a".localeCompare("A", "en", { caseFirst: "lower" }), "a".localeCompare("A", "en", { caseFirst: "false" })]',
    '["a-b".localeCompare("ab", "en", { ignorePunctuation: true }), "a-b".localeCompare("ab", "en", { ignorePunctuation: false })]',
    '["é".localeCompare("e\\u0301", "fr"), "ä".localeCompare("ae", "de", { collation: "phonebk" })]',
    '["a".localeCompare("b", [], { usage: "sort", localeMatcher: "lookup" }), "a".localeCompare("b", "en", { usage: "search", localeMatcher: "best fit" })]',
    '["2".localeCompare("10", "en-u-kn-true"), "2".localeCompare("10", "en-u-kn-true", { numeric: false })]',
    '["a".localeCompare("b", [ , "en"]), "a".localeCompare("b", { 0: "en", length: 1 })]'
  ])("retains complete native values for %s", async (expression) => {
    const expected: unknown = structuredClone(runInNewContext(expression, {}, { timeout: 1000 }));
    const result = await run("return " + expression + ";");
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toStrictEqual(deepCopyToSandbox(expected));
  });

  it.each([
    '["b", "en_US"]',
    '["b", null]',
    '["b", ["en", null]]',
    '["b", "en", null]',
    '["b", "en", { sensitivity: "bogus" }]',
    '["b", "en", { usage: "bogus" }]',
    '["b", "en", { caseFirst: "bogus" }]',
    '["b", "en", { localeMatcher: "bogus" }]'
  ])("preserves caught native error class and message for %s", async (argumentsSource) => {
    const source = `try { return { value: "a".localeCompare(...${argumentsSource}) }; } catch (error) { return { name: error.name, message: error.message }; }`;
    const expected: unknown = structuredClone(
      runInNewContext("(function () {" + source + "})()", {}, { timeout: 1000 })
    );
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toStrictEqual(deepCopyToSandbox(expected));
  });

  it("preserves evaluation traces before native errors and optional short circuit", async () => {
    const source = `
      const trace = [];
      function receiver() { trace.push("receiver"); return "a"; }
      try {
        receiver()["localeCompare"](
          (trace.push("comparison"), "b"),
          (trace.push("locale"), "en_US"),
          (trace.push("options"), {}),
          (trace.push("extra"), 1)
        );
      } catch (error) { trace.push(error.name); }
      const absent = null;
      const skipped = absent?.localeCompare(trace.push("unexpected"));
      return { trace, skipped };
    `;
    const expected: unknown = structuredClone(
      runInNewContext("(function () {" + source + "})()", {}, { timeout: 1000 })
    );
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toStrictEqual(deepCopyToSandbox(expected));
  });

  it("preserves options and reduces boolean callbacks without invoking them", async () => {
    const source = `
      let calls = 0;
      function unused() { calls += 1; return false; }
      const locales = ["en", "de"];
      const options = { numeric: unused, ignorePunctuation: [], unrelated: unused };
      const before = Object.keys(options);
      const result = "item2".localeCompare("item10", locales, options);
      return { result, calls, before, after: Object.keys(options), locales, unchanged: options.numeric === unused };
    `;
    const expected: unknown = structuredClone(
      runInNewContext("(function () {" + source + "})()", {}, { timeout: 1000 })
    );
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toStrictEqual(deepCopyToSandbox(expected));
  });

  it("passes primitive or copied data only to host collation", async () => {
    const callback = createSandboxClosure({ name: "unused", call: () => "unused" });
    const member = getStringMember("2", "localeCompare", new Budget());
    expect(isSandboxClosure(member)).toBe(true);
    if (!isSandboxClosure(member)) throw new Error("Missing localeCompare");
    const spy = vi.spyOn(String.prototype, "localeCompare");
    try {
      expect(
        await member.call([
          "10",
          ["en"],
          { numeric: callback, ignorePunctuation: [], unrelated: callback }
        ], { stack: [], thisValue: "2" })
      ).toBeLessThan(0);
      const forwarded = spy.mock.calls.at(-1);
      expect(forwarded?.[0]).toBe("10");
      expect(forwarded?.[1]).toStrictEqual(["en"]);
      expect(forwarded?.[2]).toStrictEqual({
        usage: undefined,
        localeMatcher: undefined,
        collation: undefined,
        numeric: true,
        caseFirst: undefined,
        sensitivity: undefined,
        ignorePunctuation: true
      });
    } finally {
      spy.mockRestore();
    }
  });

  it.each(["locales", "options"])("does not invoke a benign %s accessor", async (kind) => {
    let reads = 0;
    const value = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(value, kind === "locales" ? "0" : "sensitivity", {
      enumerable: true,
      get() {
        reads += 1;
        return kind === "locales" ? "en" : "base";
      }
    });
    if (kind === "locales") value.length = 1;
    const member = getStringMember("a", "localeCompare", new Budget());
    expect(isSandboxClosure(member)).toBe(true);
    if (!isSandboxClosure(member)) throw new Error("Missing localeCompare");
    const argument = value as Parameters<typeof member.call>[0][number];
    await expect(member.call(kind === "locales" ? ["b", argument] : ["b", "en", argument], { stack: [], thisValue: "a" })).rejects.toThrow(
      TypeError
    );
    expect(reads).toBe(0);
  });

  it("retains public enumerable-accessor rejection without invoking it", () => {
    let reads = 0;
    const options = {};
    Object.defineProperty(options, "numeric", {
      enumerable: true,
      get() {
        reads += 1;
        return true;
      }
    });
    expect(() => deepCopyToSandbox(options)).toThrow("accessor property");
    expect(reads).toBe(0);
  });

  it("rejects comparison closures without running them", async () => {
    let calls = 0;
    const callback = createSandboxClosure({
      name: "comparison",
      call: () => {
        calls += 1;
        return "b";
      }
    });
    const member = getStringMember("a", "localeCompare", new Budget());
    if (!isSandboxClosure(member)) throw new Error("Missing localeCompare");
    await expect(member.call([callback], { stack: [], thisValue: "a" })).rejects.toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it("does not make a fatal comparison allocation guest catchable", async () => {
    await expect(
      run('try { return "a".localeCompare(123456789); } catch (error) { return "caught"; }', {
        budget: new Budget({ stringLength: 8 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
  });

  it("keeps uncaught invalid options on the public rejection channel", async () => {
    await expect(
      run('return "a".localeCompare("b", "en", { usage: "bogus" });')
    ).rejects.toMatchObject({ name: "RangeError" });
  });

  it("preserves native full values and bound arity through completed serialization", async () => {
    const source = `
      const values = ["item10", "ä", "a", "item2"];
      const options = { numeric: true, sensitivity: "base" };
      values.sort((left, right) => left.localeCompare(right, "de", options));
      const compared = "a".localeCompare;
      return { values, options, raw: "item2".localeCompare("item10", "de", options), arity: [compared.length, compared.bind(null, "b").length] };
    `;
    const expected: unknown = structuredClone(
      runInNewContext("(function () {" + source + "})()", {}, { timeout: 1000 })
    );
    const execution = run(source);
    const first = await execution;
    expect(first.ok).toBe(true);
    if (!first.ok) throw first.error;
    expect(first.returnValue).toStrictEqual(deepCopyToSandbox(expected));
    const capture = await dump(execution);
    const replay = await run(source, { snapshot: restore(JSON.parse(capture), { source }) });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw replay.error;
    expect(replay.returnValue).toStrictEqual(deepCopyToSandbox(expected));
  });
});
