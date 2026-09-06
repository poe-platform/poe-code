import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { Budget } from "../interp/budget.js";
import { run } from "../run.js";
import { parse } from "./parser.js";
import { tokenize } from "./tokenizer.js";

describe("keyword object method names", () => {
  it.each([
    "const",
    "let",
    "if",
    "else",
    "for",
    "do",
    "while",
    "return",
    "break",
    "continue",
    "try",
    "catch",
    "finally",
    "throw",
    "function",
    "async",
    "await",
    "yield",
    "import",
    "from",
    "as",
    "true",
    "false",
    "null",
    "undefined",
    "typeof",
    "void",
    "delete",
    "this",
    "instanceof",
    "in",
    "of",
    "new",
    "class",
    "export",
    "default"
  ])("uses %s as a method name without relaxing bindings", async (name) => {
    const source = `const object = { value: 5, ${name}(amount) { return this.value + amount; } }; return object.${name}(2);`;
    const native = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1_000 });

    expect(native).toBe(7);
    await expect(
      run(source, { modules: {}, budget: new Budget({ maxSteps: 1_000 }) })
    ).resolves.toMatchObject({ ok: true, returnValue: native });
  });

  it("parses keyword method names as identifier names with method metadata", () => {
    expect(parse("({ return(value) { return value; } })")).toMatchObject({
      type: "ObjectExpression",
      properties: [
        {
          computed: false,
          shorthand: false,
          key: { type: "Identifier", name: "return" },
          value: { type: "FunctionExpression", method: true, async: false, generator: false }
        }
      ]
    });
    expect(tokenize("return")[0].type).toBe("keyword");
  });

  it("accepts an escaped keyword as an ordinary method name", async () => {
    const source = "return { ret\\u0075rn() { return 7; } }.return();";
    expect(runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1_000 })).toBe(7);
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: 7 });
  });

  it.each(["return", "if", "for", "while", "throw", "try", "const", "import", "this"])(
    "keeps reserved binding and shorthand %s rejected",
    (name) => {
      for (const source of [`const ${name} = 1;`, `return { ${name} };`]) {
        expect(() =>
          runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1_000 })
        ).toThrow();
        expect(() => parse(source)).toThrow();
      }
    }
  );
});

describe("async object method property-name composition", () => {
  it.each([
    ["named", "read", "read"],
    ["keyword", "return", "return"],
    ["computed", '["read"]', "read"],
    ["nested computed", '[["read"][0]]', "read"],
    ["template computed", '[`re${"ad"}`]', "read"],
    ["string literal", '"read"', "read"],
    ["numeric literal", "2", "2"],
    ["boolean name", "true", "true"]
  ])("supports the %s property-name form", async (_name, property, lookup) => {
    const source = `const object = { value: 5, async ${property}(amount) { return await Promise.resolve(this.value + amount); } }; return await object[${JSON.stringify(lookup)}](2);`;
    const native = await runInNewContext(
      `(async function () { ${source} })()`,
      {},
      { timeout: 1_000 }
    );

    expect(native).toBe(7);
    await expect(
      run(source, { modules: {}, budget: new Budget({ maxSteps: 1_000 }) })
    ).resolves.toMatchObject({ ok: true, returnValue: native });
  });

  it("marks async computed methods and evaluates the key once", async () => {
    expect(parse('({ async ["read"]() { return 7; } })')).toMatchObject({
      properties: [
        {
          computed: true,
          shorthand: false,
          value: { async: true, generator: false, method: true, span: { start: { offset: 3 } } },
          span: { start: { offset: 3 } }
        }
      ]
    });
    const source =
      'let count = 0; const object = { async [(count++, "read")]() { return count; } }; return [await object.read(), count];';
    expect(
      await runInNewContext(`(async function () { ${source} })()`, {}, { timeout: 1_000 })
    ).toEqual([1, 1]);
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: [1, 1] });
  });

  it.each([
    "({ async\nread() {} })",
    '({ async\n["read"]() {} })',
    '({ async /*\n*/ ["read"]() {} })',
    '({ async ["read"]: 1 })',
    '({ async ["read"] })',
    '({ async "read": 1 })',
    "({ as\\u0079nc read() {} })",
    '({ as\\u0079nc ["read"]() {} })'
  ])("rejects invalid async method syntax: %s", (source) => {
    expect(() => runInNewContext(source, {}, { timeout: 1_000 })).toThrow();
    expect(() => parse(source)).toThrow();
  });

  it.each([
    "return { async() { return 7; } }.async();",
    "return { as\\u0079nc() { return 7; } }.async();",
    "const async = 7; return { async }.async;",
    "return { async: 7 }.async;",
    'return { ["read"]() { return 7; } }.read();',
    "return await { async /* same line */ read() { return 7; } }.read();"
  ])("preserves ordinary async names and existing methods: %s", async (source) => {
    const native = await runInNewContext(
      `(async function () { ${source} })()`,
      {},
      { timeout: 1_000 }
    );
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toBe(native);
  });

  it.each([
    "({ get return() {} })",
    "({ set return(value) {} })",
    '({ get ["read"]() {} })',
    "({ *return() {} })"
  ])("accepts accessor and generator property names: %s", (source) => {
    expect(() => runInNewContext(source, {}, { timeout: 1_000 })).not.toThrow();
    expect(() => parse(source)).not.toThrow();
  });

  it.each([
    ['({ async *["read"]() {} })', "Generator shorthand methods are not supported"]
  ])("keeps unsupported shorthand rejected: %s", (source, message) => {
    expect(() => runInNewContext(source, {}, { timeout: 1_000 })).not.toThrow();
    expect(() => parse(source)).toThrow(message);
  });
});
