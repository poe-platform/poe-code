import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createSandboxRegex } from "../values.js";
import { callStringMethod } from "./string.js";

const originalWorkflow = [
  "function buildPreview(template, view) {",
  "  const tokens = [];",
  "  const captures = [];",
  "  const expression = /\\{\\{\\s*([A-Za-z_][A-Za-z_0-9]*)(?:\\|([^{}]*))?\\s*\\}\\}/g;",
  "  for (const match of template.matchAll(expression)) {",
  "    tokens.push({ name: match[1], fallback: match[2] || '', offset: match.index, raw: match[0] });",
  "  }",
  "  const rendered = template.replace(expression, (whole, name, fallback, offset, input) => {",
  "    captures.push({ name, fallback: fallback === undefined ? null : fallback, offset, inputLength: input.length });",
  "    const value = view[name] === undefined ? (fallback || '') : String(view[name]);",
  "    return value.normalize('NFC');",
  "  });",
  "  const annotated = template.replace(expression, '[$1:$2|$$|$&]');",
  '  const prefixViews = template.replace(expression, "<$`>");',
  '  const suffixViews = template.replace(expression, "<$\'>");',
  "  return {",
  "    tokens, captures, rendered, annotated, prefixViews, suffixViews,",
  "    codePoints: Array.from(rendered).map(character => character.codePointAt(0)),",
  "    normalized: rendered.normalize('NFC'),",
  "    pieces: template.split(/(\\{\\{[^{}]*\\}\\})/),",
  "    literalReplacement: template.replaceAll('{{name}}', '$$&'),",
  "    sourceTemplate: String.raw`prefix\\n${view.name}\\tend`",
  "  };",
  "}",
  "return [",
  "  { template: '🧪{{name}} / {{missing|é}}!', view: { name: '名称' } },",
  "  { template: '{{name}}-{{name}}-{{count|zero}}', view: { name: 'café', count: 0 } },",
  "  { template: 'literal 🧪 é', view: { name: 'Ω' } }",
  "].map(fixture => buildPreview(fixture.template, fixture.view));",
  ""
].join("\n");

const workflowAnchors = [
  {
    rendered: "🧪名称 / é!",
    annotated: "🧪[name:|$|{{name}}] / [missing:é|$|{{missing|é}}]!",
    prefixViews: "🧪<🧪> / <🧪{{name}} / >!",
    suffixViews: "🧪< / {{missing|é}}!> / <!>!",
    literalReplacement: "🧪$& / {{missing|é}}!"
  },
  {
    rendered: "café-café-0",
    annotated: "[name:|$|{{name}}]-[name:|$|{{name}}]-[count:zero|$|{{count|zero}}]",
    prefixViews: "<>-<{{name}}->-<{{name}}-{{name}}->",
    suffixViews: "<-{{name}}-{{count|zero}}>-<-{{count|zero}}>-<>",
    literalReplacement: "$&-$&-{{count|zero}}"
  },
  {
    rendered: "literal 🧪 é",
    annotated: "literal 🧪 é",
    prefixViews: "literal 🧪 é",
    suffixViews: "literal 🧪 é",
    literalReplacement: "literal 🧪 é"
  }
];

describe("STR-03 independent original-source validation", () => {
  it("matches workflow 06 replacement/control fields, not STR-01 token metadata", async () => {
    const native = runInNewContext(
      "(function () {" + originalWorkflow + "})()",
      {},
      { timeout: 100 }
    ) as Record<string, unknown>[];
    native.forEach((value, index) => expect(value).toMatchObject(workflowAnchors[index]));
    expect(native.map((value) => value.tokens)).toMatchObject([
      [{ offset: 2 }, { offset: 13 }],
      [{ offset: 0 }, { offset: 9 }, { offset: 18 }],
      []
    ]);

    const result = await run(originalWorkflow, {
      modules: {},
      budget: new Budget({
        maxSteps: 10000,
        maxCallDepth: 48,
        deadline: Date.now() + 1000,
        stringLength: 32768,
        arrayLength: 4096,
        dataSize: 2097152
      })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const actual = result.returnValue as Record<string, unknown>[];
    expect(actual).toHaveLength(native.length);
    native.forEach((value, index) => {
      for (const field of Object.keys(value)) {
        if (field !== "tokens") expect(actual[index][field], field).toEqual(value[field]);
      }
      const expectedTokens = value.tokens as Record<string, unknown>[];
      const actualTokens = actual[index].tokens as Record<string, unknown>[];
      expect(actualTokens).toHaveLength(expectedTokens.length);
      expectedTokens.forEach((token, tokenIndex) => {
        for (const field of ["name", "fallback", "raw"]) {
          expect(actualTokens[tokenIndex][field], field).toEqual(token[field]);
        }
      });
    });
  });

  it.each([
    {
      name: "strings/reductions/r03-replacement-captures.safejs",
      source:
        "return {\n  missingOptional: 'a'.replace(/a(b)?/, '<$1>'),\n  presentOptional: 'ab'.replace(/a(b)?/, '<$1>'),\n  nonexistent: 'a'.replace(/(a)/, '<$2>'),\n  fallbackTwoDigit: 'a'.replace(/(a)/, '<$10>'),\n  zeroPaddedCapture: 'a'.replace(/(a)/, '<$01>'),\n  escapedDollar: 'a'.replace(/(a)/, '$$:$&:$1')\n};\n",
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
      name: "strings/reductions/r04-replacement-context.safejs",
      source:
        "return {\n  regexPrefix: 'abc'.replace(/b/, '$`'),\n  regexSuffix: 'abc'.replace(/b/, \"$'\"),\n  literalPrefix: 'abc'.replace('b', '$`'),\n  globalContext: 'a1b2c'.replaceAll(/\\d/g, \"[$`|$']\")\n};\n",
      expected: {
        regexPrefix: "aac",
        regexSuffix: "acc",
        literalPrefix: "aac",
        globalContext: "a[a|b2c]b[a1b|c]c"
      }
    }
  ])("retains exact native return values for $name", async ({ source, expected }) => {
    const native = runInNewContext("(function () {" + source + "})()", {}, { timeout: 100 });
    expect(native).toEqual(expected);
    const result = await run(source, {
      modules: {},
      budget: new Budget({ maxSteps: 1000, deadline: Date.now() + 1000 })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(expected);
  });
});

const numericFixtures = [
  { name: "no captures", input: "a", pattern: "a", anchor: "$09|$10|$12|$99|$100|$999" },
  { name: "one capture", input: "a", pattern: "(a)", anchor: "$09|a0|a2|$99|a00|$999" },
  { name: "unset capture", input: "a", pattern: "a(b)?", anchor: "$09|0|2|$99|00|$999" },
  { name: "empty capture", input: "a", pattern: "a(b*)", anchor: "$09|0|2|$99|00|$999" },
  {
    name: "nine captures",
    input: "abcdefghi",
    pattern: "(a)(b)(c)(d)(e)(f)(g)(h)(i)",
    anchor: "i|a0|a2|i9|a00|i99"
  },
  {
    name: "ten captures",
    input: "abcdefghij",
    pattern: "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)",
    anchor: "i|j|a2|i9|j0|i99"
  },
  {
    name: "unset tenth capture",
    input: "abcdefghi",
    pattern: "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)?",
    anchor: "i||a2|i9|0|i99"
  },
  {
    name: "twelve captures",
    input: "abcdefghijkl",
    pattern: "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)",
    anchor: "i|j|l|i9|j0|i99"
  },
  {
    name: "ninety-nine captures",
    input: "Z",
    pattern: "()".repeat(98) + "(Z)",
    anchor: "|||Z|0|Z9"
  },
  {
    name: "hundredth capture is not addressable",
    input: "Z",
    pattern: "()".repeat(99) + "(Z)",
    anchor: "||||0|9"
  }
];

describe.each([
  { method: "replace", flags: "" },
  { method: "replace", flags: "g" },
  { method: "replaceAll", flags: "g" }
] as const)("independent $method /$flags routes", ({ method, flags }) => {
  it.each(numericFixtures)(
    "anchors and enumerates numeric tokens: $name",
    async ({ input, pattern, anchor }) => {
      const anchoredTemplate = "$09|$10|$12|$99|$100|$999";
      expect(input[method](new RegExp(pattern, flags), anchoredTemplate)).toBe(anchor);
      expect(
        await callStringMethod(
          input,
          method,
          [createSandboxRegex(pattern, flags), anchoredTemplate],
          new Budget()
        )
      ).toBe(anchor);
      const tokens = Array.from(
        { length: 100 },
        (_, index) => "$" + String(index).padStart(2, "0")
      );
      tokens.push(
        "$0",
        "$1",
        "$9",
        "$000",
        "$001",
        "$010",
        "$099",
        "$100",
        "$101",
        "$123",
        "$990",
        "$999",
        "$$1",
        "$$01",
        "$$$01",
        "$$$$01",
        "$1$01",
        "$01$1",
        "$",
        "$x",
        "$<name>"
      );
      const replacement = tokens.join("|");
      const native = input[method](new RegExp(pattern, flags), replacement);
      expect(
        await callStringMethod(
          input,
          method,
          [createSandboxRegex(pattern, flags), replacement],
          new Budget()
        )
      ).toBe(native);
    }
  );

  it("uses original input, never prior output or recursively expanded token text", async () => {
    const input = "🧪a-$1a!";
    const replacement = "[$$|$&|$1|$`|$']";
    const native = input[method](new RegExp("(a)", flags), replacement);
    expect(native).toBe(
      flags === "g" ? "🧪[$|a|a|🧪|-$1a!]-$1[$|a|a|🧪a-$1|!]!" : "🧪[$|a|a|🧪|-$1a!]-$1a!"
    );
    expect(
      await callStringMethod(
        input,
        method,
        [createSandboxRegex("(a)", flags), replacement],
        new Budget()
      )
    ).toBe(native);
  });

  it.each([
    { input: "$&", pattern: "(.+)", replacement: "$1", expected: "$&" },
    { input: "a", pattern: "(a)", replacement: "$$1|$$&|$$`|$$'", expected: "$1|$&|$`|$'" },
    { input: "abc", pattern: "z", replacement: "$&|$1|$`|$'", expected: "abc" },
    { input: "abc", pattern: "b", replacement: "", expected: "ac" },
    { input: "abc", pattern: "b", replacement: "plain", expected: "aplainc" },
    {
      input: "ab",
      pattern: "(?:)",
      replacement: "<$`|$'>",
      expected: flags === "g" ? "<|ab>a<a|b>b<ab|>" : "<|ab>ab"
    }
  ])(
    "anchors $input /$pattern/ -> $replacement",
    async ({ input, pattern, replacement, expected }) => {
      expect(input[method](new RegExp(pattern, flags), replacement)).toBe(expected);
      expect(
        await callStringMethod(
          input,
          method,
          [createSandboxRegex(pattern, flags), replacement],
          new Budget()
        )
      ).toBe(expected);
    }
  );
});

describe.each(["replace", "replaceAll"] as const)("independent literal %s controls", (method) => {
  it.each([
    { input: "aba", search: "a" },
    { input: "abc", search: "z" },
    { input: "ab", search: "" },
    { input: "", search: "" }
  ])("retains native tokens for $input / $search", async ({ input, search }) => {
    const replacement = "[$$|$&|$01|$1|$10|$`|$']";
    const native = input[method](search, replacement);
    expect(await callStringMethod(input, method, [search, replacement], new Budget())).toBe(native);
  });
});

it("keeps callback return tokens literal on regex and literal routes", async () => {
  const source =
    "return { regex: 'aba'.replace(/(a)/g, () => \"$1:$`:$'\"), regexAll: 'aba'.replaceAll(/(a)/g, () => \"$1:$`:$'\"), literal: 'aba'.replace('a', () => \"$1:$`:$'\"), literalAll: 'aba'.replaceAll('a', () => \"$1:$`:$'\") };";
  const native = runInNewContext("(function () {" + source + "})()", {}, { timeout: 100 });
  expect(native).toEqual({
    regex: "$1:$`:$'b$1:$`:$'",
    regexAll: "$1:$`:$'b$1:$`:$'",
    literal: "$1:$`:$'ba",
    literalAll: "$1:$`:$'b$1:$`:$'"
  });
  const result = await run(source, { modules: {}, budget: new Budget({ maxSteps: 1000 }) });
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.returnValue).toEqual(native);
});
