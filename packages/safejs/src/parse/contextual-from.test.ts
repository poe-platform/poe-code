import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { run } from "../run.js";
import { parse, parseModule } from "./parser.js";
import { extractTopLevelExports } from "./parse-export.js";
import { tokenize } from "./tokenizer.js";

describe("contextual from", () => {
  it("tokenizes from as an identifier in ordinary and import positions", () => {
    const tokens = tokenize('const from = 2; import from from "fixture";');

    expect(tokens.filter((token) => token.value === "from").map((token) => token.type)).toEqual([
      "identifier",
      "identifier",
      "identifier"
    ]);
  });

  it("keeps division after from distinct from a regex literal", () => {
    expect(tokenize("from / 2 / 3").map((token) => [token.type, token.value])).toEqual([
      ["identifier", "from"],
      ["punctuator", "/"],
      ["numeric", "2"],
      ["punctuator", "/"],
      ["numeric", "3"],
      ["eof", ""]
    ]);
  });

  it.each([
    ["const binding", "const from = 2; return from;", 2],
    ["let assignment", "let from = 1; from += 1; return from;", 2],
    ["var binding", "var from = 2; return from;", 2],
    ["function name", "function from(value) { return value; } return from(2);", 2],
    ["function parameter", "function value(from) { return from; } return value(2);", 2],
    ["function expression", "const value = function from() { return 2; }; return value();", 2],
    ["arrow parameter", "const value = from => from; return value(2);", 2],
    ["default parameter", "const value = (from = 2) => from; return value();", 2],
    ["rest parameter", "const value = (...from) => from[0]; return value(2);", 2],
    ["array binding", "const [from] = [2]; return from;", 2],
    ["object binding", "const { from } = { from: 2 }; return from;", 2],
    ["object default binding", "const { from = 2 } = {}; return from;", 2],
    ["object alias", "const { from: value } = { from: 2 }; return value;", 2],
    ["object assignment", "let from; ({ from } = { from: 2 }); return from;", 2],
    ["catch binding", "try { throw 2; } catch (from) { return from; }", 2],
    ["for-of binding", "let value = 0; for (const from of [2]) value += from; return value;", 2],
    [
      "for binding",
      "let value = 0; for (let from = 0; from < 2; from++) value++; return value;",
      2
    ],
    ["bare object key", "const value = { from: 2 }; return value.from;", 2],
    ["shorthand key", "const from = 2; return { from }.from;", 2],
    ["method name", "return { from() { return 2; } }.from();", 2],
    ["computed key", "const from = 'value'; return { [from]: 2 }.value;", 2],
    ["division", "const from = 12; return from / 2 / 3;", 2],
    ["division assignment", "let from = 4; from /= 2; return from;", 2],
    ["template division", "const from = 12; return `${from / 2 / 3}`;", "2"],
    ["escaped binding", "const fr\\u006fm = 2; return from;", 2]
  ])("executes %s like native JavaScript", async (_name, source, expected) => {
    expect(runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1_000 })).toBe(expected);
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "const value = async from => from; return await value(2);",
    "return await { async from() { return 2; } }.from();"
  ])("accepts from in async syntax: %s", async (source) => {
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: 2 });
  });

  it.each([
    ['import from from "fixture";', "ImportDefaultSpecifier", "from"],
    ['import * as from from "fixture";', "ImportNamespaceSpecifier", "from"],
    ['import { from } from "fixture";', "ImportSpecifier", "from"],
    ['import { value as from } from "fixture";', "ImportSpecifier", "from"],
    ['import { from as value } from "fixture";', "ImportSpecifier", "value"]
  ])("preserves the import separator in %s", (source, type, local) => {
    expect(parseModule(source).body[0]).toMatchObject({
      type: "ImportDeclaration",
      specifiers: [{ type, local: { type: "Identifier", name: local } }],
      source: { type: "StringLiteral", value: "fixture" }
    });
  });

  it("resolves named imports using from without external I/O", async () => {
    await expect(
      run('import { from } from "fixture"; return from;', {
        modules: { fixture: { from: 2 } }
      })
    ).resolves.toMatchObject({ ok: true, returnValue: 2 });
  });

  it("preserves supported exports with ordinary from bindings", () => {
    const module = parseModule("export const from = 2; export default from;");

    expect(extractTopLevelExports(module)).toMatchObject([
      { type: "named", name: "from", declaration: { id: { name: "from" } } },
      { type: "default", declaration: { type: "Identifier", name: "from" } }
    ]);
  });

  it.each([
    'import value "fixture";',
    'import value other "fixture";',
    'import value "from" "fixture";',
    "import value from from;"
  ])("still rejects malformed import syntax: %s", (source) => {
    expect(() => parseModule(source)).toThrow();
  });

  it.each([
    'export { from } from "fixture";',
    'export * from "fixture";',
    "const return = 2;",
    "let if = 2;"
  ])("does not expand unsupported or reserved syntax: %s", (source) => {
    expect(() => parseModule(source)).toThrow();
  });

  it("parses a bare from property as an ordinary noncomputed key", () => {
    expect(parse("({ from: 2 })")).toMatchObject({
      type: "ObjectExpression",
      properties: [
        {
          type: "Property",
          computed: false,
          shorthand: false,
          key: { type: "Identifier", name: "from" }
        }
      ]
    });
  });
});
