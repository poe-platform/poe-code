import { expect, it, vi } from "vitest";
import { createEvalSource } from "./dynamic-source.js";
import { CompactSourcePositions } from "./compact-spans.js";
import { tokenize, tokenizeCompact } from "./tokenizer.js";

it("defers compiler token coordinates until read and preserves them after eviction", () => {
  const source = "alpha;" + "beta;".repeat(1000);
  const positions = new CompactSourcePositions(source);
  const tokens = tokenizeCompact(source, {}, positions, true);
  const read = vi.spyOn(positions, "position");
  try {
    const first = tokens[0]!;
    expect([first.type, first.value]).toEqual(["identifier", "alpha"]);
    expect(read).not.toHaveBeenCalled();
    const start = first.start;
    expect(start).toEqual({ line: 1, column: 1, offset: 0 });
    expect(read).toHaveBeenCalledTimes(1);
    const end = first.end;
    expect(end).toEqual({ line: 1, column: 6, offset: 5 });
    expect(read).toHaveBeenCalledTimes(2);
    for (let index = 1; index < tokens.length; index++) void tokens[index]!.start;
    read.mockClear();
    expect(first.start).toBe(start);
    expect(first.end).toBe(end);
    expect(read).not.toHaveBeenCalled();
    expect(Object.isFrozen(start)).toBe(true);
    const restored = tokens[0]!;
    expect(restored).not.toBe(first);
    expect(restored.start).toEqual(start);
    expect(restored.end).toEqual(end);
  } finally {
    read.mockRestore();
  }
});

const fixtures = [
  "<!-- legacy\nvar value=010;value='\\1';\n--> tail",
  "/* before */\r\nconst astral='😀';\u2028// comment\u2029const value=`a${astral}b${`c${1}`}`;",
  "class Example {#x=1;static {this.marker=2;}get value(){return this.#x;}}",
  "const value={class:1,async method(){return /a[b-c]+/g;}};for(const item of /a/.exec('a')){};",
  `function long(${Array.from({ length: 400 }, (_, i) => `arg${i}=()=>${i}`).join(",")}){return arg0;}long();`,
  `const value=(${Array.from({ length: 800 }, (_, i) => `v${i}`).join(",")})=>({value:v0,method(){return this.value;}});`,
  `const value=[${Array.from({ length: 3000 }, (_, i) => `${i}`).join(",")}];`
];

it.each(fixtures)("keeps compiler token values and coordinates equivalent: %j", source => {
  const options = {
    allowRegexLiterals: true, statementList: true, allowLegacyNumbers: true,
    allowLegacyEscapes: true, allowHtmlComments: true
  };
  const tokens = tokenizeCompact(source, options, new CompactSourcePositions(source), true);
  const control = tokenize(source, options);
  for (let pass = 0; pass < 2; pass++) {
    expect(Array.from(tokens, token => ({
      type: token.type, value: token.value, start: token.start, end: token.end,
      ...(token.legacyEscape === undefined ? {} : { legacyEscape: token.legacyEscape }),
      ...(token.templateExpressions === undefined ? {} : { templateExpressions: token.templateExpressions })
    }))).toEqual(control);
  }
});

it.each(fixtures)("preserves classic scanner output after cache eviction: %j", (source) => {
  const options = {
    allowRegexLiterals: true,
    statementList: true,
    allowLegacyNumbers: true,
    allowLegacyEscapes: true,
    allowHtmlComments: true
  };
  const actual = tokenizeCompact(source, options, new CompactSourcePositions(source));
  const control = tokenize(source, options);
  expect(Array.from(actual)).toEqual(control);
  expect(Array.from(actual)).toEqual(control);
  expect(actual.at(-1)?.type).toBe("eof");
  expect(actual[actual.length]).toBeUndefined();
});

it("preserves scanner annotations on the most recently published token", () => {
  const source = "'\\1';`a${`b${1}`}c`;";
  const options = { allowLegacyEscapes: true, allowRegexLiterals: true };
  const actual = Array.from(tokenizeCompact(source, options, new CompactSourcePositions(source)));
  expect(actual).toEqual(tokenize(source, options));
  expect(actual[0]!.legacyEscape).toBe(true);
  expect(actual[2]!.templateExpressions).toHaveLength(1);
});

it.each(fixtures)(
  "preserves parser lookahead, rebased templates and source indexes: %j",
  (source) => {
    const control = createEvalSource(source, {}, undefined, "fixture.js");
    const actual = createEvalSource(source, {}, undefined, "fixture.js", { compactAst: true });
    expect(actual.strict).toBe(control.strict);
    expect(actual.node).toEqual(control.node);
    expect([...actual.source.nodes.keys()]).toEqual([...control.source.nodes.keys()]);
    for (const [id, node] of control.source.nodes) {
      const candidate = actual.source.nodes.get(id)!;
      expect(candidate).toEqual(node);
      expect(candidate.nodeId).toBe(node.nodeId);
    }
  }
);

it.each([
  "const = 1;",
  "const value=`bad${;}`;",
  "const first=1;const first=2;",
  "'use strict';const value='\\1';",
  "const value=/unterminated;"
])("preserves classic syntax diagnostics for %j", (source) => {
  const errors = [false, true].map((compactAst) => {
    try {
      createEvalSource(source, {}, undefined, "fixture.js", { compactAst });
    } catch (error) {
      return error as Error;
    }
    throw new Error("Expected syntax rejection.");
  });
  expect(errors[1]).toMatchObject({ name: errors[0]!.name, message: errors[0]!.message });
  expect(Object.getOwnPropertyNames(errors[1])).toEqual(Object.getOwnPropertyNames(errors[0]));
});
