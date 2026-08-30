import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createSandboxRegex } from "../values.js";
import { callStringMethod } from "./string.js";

describe.each([
  { method: "replace", flags: "" },
  { method: "replace", flags: "g" },
  { method: "replaceAll", flags: "g" }
] as const)("$method substitution strings with '$flags' regex flags", ({ method, flags }) => {
  it.each([
    ["unset capture", "a", "a(b)?", "<$1>", "<>"],
    ["present capture", "ab", "a(b)?", "<$1>", "<b>"],
    ["empty capture", "a", "a(b*)", "<$1>", "<>"],
    ["nonexistent capture", "a", "(a)", "<$2>", "<$2>"],
    ["two-digit fallback", "a", "(a)", "<$10>", "<a0>"],
    ["unset two-digit fallback", "a", "a(b)?", "<$10>", "<0>"],
    ["zero-padded capture", "a", "(a)", "<$01>", "<a>"],
    ["unset zero-padded capture", "a", "a(b)?", "<$01>", "<>"],
    ["nonexistent zero-padded capture", "a", "(a)", "<$02>", "<$02>"],
    ["zero is not a capture", "a", "(a)", "$0|$00|$000", "$0|$00|$000"],
    ["dollar and whole match", "a", "(a)", "$$:$&:$1", "$:a:a"],
    ["escaped tokens are not rescanned", "a", "(a)", "$$1|$$&|$$`|$$'", "$1|$&|$`|$'"],
    ["capture text is not rescanned", "$&", "(.+)", "<$1>", "<$&>"],
    ["prefix context", "abc", "b", "$`", "aac"],
    ["suffix context", "abc", "b", "$'", "acc"],
    ["UTF-16 context", "🧪bΩ", "b", "[$`|$&|$']", "🧪[🧪|b|Ω]Ω"],
    ["empty prefix", "abc", "a", "<$`>", "<>bc"],
    ["empty suffix", "abc", "c", "<$'>", "ab<>"],
    ["zero-width context", "abc", "$", "[$`|$&|$']", "abc[abc||]"],
    ["literal replacement", "abc", "b", "literal", "aliteralc"],
    ["empty replacement", "abc", "b", "", "ac"],
    ["nonmatch", "abc", "z", "$$:$&:$1:$`:$'", "abc"],
    ["unknown tokens", "a", "(a)", "$x|$<name>|$", "$x|$<name>|$"],
    ["no captures", "a", "a", "$1|$01|$10|$99", "$1|$01|$10|$99"],
    [
      "two-digit captures and fallback",
      "abcdefghij",
      "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)",
      "$10|$11|$01|$09|$99|$100",
      "j|a1|a|i|i9|j0"
    ],
    [
      "unset tenth capture",
      "abcdefghi",
      "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)?",
      "<$10|$100|$11>",
      "<|0|a1>"
    ],
    ["highest two-digit capture", "a".repeat(99), "(a)".repeat(99), "$99|$990", "a|a0"]
  ])("%s", async (_name, input, pattern, replacement, expected) => {
    const native = input[method](new RegExp(pattern, flags), replacement);
    expect(native).toBe(expected);

    const actual = await callStringMethod(
      input,
      method,
      [createSandboxRegex(pattern, flags), replacement],
      new Budget()
    );

    expect(actual).toBe(native);
  });

  it("uses original input context at every occurrence", async () => {
    const input = "a1b2c";
    const replacement = "[$`|$&|$']";
    const native = input[method](new RegExp("[0-9]", flags), replacement);
    expect(native).toBe(flags === "g" ? "a[a|1|b2c]b[a1b|2|c]c" : "a[a|1|b2c]b2c");

    expect(
      await callStringMethod(
        input,
        method,
        [createSandboxRegex("[0-9]", flags), replacement],
        new Budget()
      )
    ).toBe(native);
  });
});

describe.each(["replace", "replaceAll"] as const)("%s literal search controls", (method) => {
  it.each([
    ["abc", "b"],
    ["abcb", "b"],
    ["abc", "z"],
    ["abc", ""],
    ["", ""]
  ])("preserves native tokens for %j searching %j", async (input, search) => {
    const replacement = "[$$|$&|$1|$01|$10|$`|$']";
    const native = input[method](search, replacement);

    expect(await callStringMethod(input, method, [search, replacement], new Budget())).toBe(native);
  });
});

describe("replacement source regressions", () => {
  it.each([
    {
      name: "original STR-03 capture reduction",
      source: [
        "return {",
        "  missingOptional: 'a'.replace(/a(b)?/, '<$1>'),",
        "  presentOptional: 'ab'.replace(/a(b)?/, '<$1>'),",
        "  nonexistent: 'a'.replace(/(a)/, '<$2>'),",
        "  fallbackTwoDigit: 'a'.replace(/(a)/, '<$10>'),",
        "  zeroPaddedCapture: 'a'.replace(/(a)/, '<$01>'),",
        "  escapedDollar: 'a'.replace(/(a)/, '$$:$&:$1')",
        "};"
      ].join("\n"),
      expected: {
        missingOptional: "<>",
        presentOptional: "<b>",
        nonexistent: "<$2>",
        fallbackTwoDigit: "<a0>",
        zeroPaddedCapture: "<a>",
        escapedDollar: "$:a:a"
      }
    },
    {
      name: "original STR-03 context reduction",
      source: [
        "return {",
        "  regexPrefix: 'abc'.replace(/b/, '$`'),",
        "  regexSuffix: 'abc'.replace(/b/, \"$'\"),",
        "  literalPrefix: 'abc'.replace('b', '$`'),",
        "  globalContext: 'a1b2c'.replaceAll(/\\d/g, \"[$`|$']\")",
        "};"
      ].join("\n"),
      expected: {
        regexPrefix: "aac",
        regexSuffix: "acc",
        literalPrefix: "aac",
        globalContext: "a[a|b2c]b[a1b|c]c"
      }
    }
  ])("$name", async ({ source, expected }) => {
    const native = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 100 });
    expect(native).toEqual(expected);

    const result = await run(source, { modules: {}, budget: new Budget({ maxSteps: 1000 }) });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.returnValue).toEqual(native);
  });

  it("renders, annotates, previews, and redacts templates without leaking capture tokens", async () => {
    const source = [
      "function buildPreview(template, view) {",
      "  const captures = [];",
      "  const expression = /\\{\\{\\s*([A-Za-z_][A-Za-z_0-9]*)(?:\\|([^{}]*))?\\s*\\}\\}/g;",
      "  const rendered = template.replace(expression, (whole, name, fallback, offset, input) => {",
      "    captures.push({ name, fallback: fallback === undefined ? null : fallback, offset, inputLength: input.length });",
      "    const value = view[name] === undefined ? (fallback || '') : String(view[name]);",
      "    return value.normalize('NFC');",
      "  });",
      "  return {",
      "    captures, rendered,",
      "    annotated: template.replace(expression, '[$1:$2|$$|$&]'),",
      '    prefixViews: template.replace(expression, "<$`>"),',
      '    suffixViews: template.replace(expression, "<$\'>"),',
      "    literalReplacement: template.replaceAll('{{name}}', '$$&'),",
      "    redacted: template.replaceAll(expression, '{{$01|[redacted]$2}}'),",
      '    callbackLiteral: template.replace(expression, () => "$1:$`:$\'")',
      "  };",
      "}",
      "return [",
      "  { template: '🧪{{name}} / {{missing|é}}!', view: { name: '名称' } },",
      "  { template: '{{name}}-{{name}}-{{count|zero}}', view: { name: 'café', count: 0 } },",
      "  { template: 'literal 🧪 é', view: { name: 'Ω' } }",
      "].map(fixture => buildPreview(fixture.template, fixture.view));"
    ].join("\n");
    const native = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 100 });
    expect(native[0]).toMatchObject({
      rendered: "🧪名称 / é!",
      annotated: "🧪[name:|$|{{name}}] / [missing:é|$|{{missing|é}}]!",
      prefixViews: "🧪<🧪> / <🧪{{name}} / >!",
      suffixViews: "🧪< / {{missing|é}}!> / <!>!",
      redacted: "🧪{{name|[redacted]}} / {{missing|[redacted]é}}!",
      callbackLiteral: "🧪$1:$`:$' / $1:$`:$'!"
    });
    expect(native[1].rendered).toBe("café-café-0");
    expect(native[2].annotated).toBe("literal 🧪 é");

    const result = await run(source, {
      modules: {},
      budget: new Budget({ maxSteps: 10000, stringLength: 32768, arrayLength: 4096 })
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.returnValue).toEqual(native);
  });

  it("still rejects replaceAll with a non-global regex", () => {
    expect(() => "a".replaceAll(/a/, "$1")).toThrow(TypeError);
    expect(() =>
      callStringMethod("a", "replaceAll", [createSandboxRegex("a"), "$1"], new Budget())
    ).toThrow("String#replaceAll requires a global regex.");
  });
});
