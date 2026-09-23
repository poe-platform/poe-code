import { expect, it } from "vitest";
import { createEvalSource } from "./dynamic-source.js";
import { CompactSourcePositions } from "./compact-spans.js";
import { tokenize, tokenizeCompact } from "./tokenizer.js";

const fixtures = [
  "<!-- legacy\nvar value=010;value='\\1';\n--> tail",
  "/* before */\r\nconst astral='😀';\u2028// comment\u2029const value=`a${astral}b${`c${1}`}`;",
  "class Example {#x=1;static {this.marker=2;}get value(){return this.#x;}}",
  "const value={class:1,async method(){return /a[b-c]+/g;}};for(const item of /a/.exec('a')){};",
  `function long(${Array.from({ length: 400 }, (_, i) => `arg${i}=()=>${i}`).join(",")}){return arg0;}long();`,
  `const value=(${Array.from({ length: 800 }, (_, i) => `v${i}`).join(",")})=>({value:v0,method(){return this.value;}});`,
  `const value=[${Array.from({ length: 3000 }, (_, i) => `${i}`).join(",")}];`
];

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
