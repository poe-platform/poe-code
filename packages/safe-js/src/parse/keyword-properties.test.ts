import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { lint, run } from "../core.js";
import { dump } from "../dump.js";
import { parse } from "./parser.js";

const names = [
  "const", "let", "if", "else", "for", "do", "while", "return", "break",
  "continue", "try", "catch", "finally", "throw", "function", "async", "await",
  "yield", "import", "from", "as", "true", "false", "null", "undefined",
  "typeof", "void", "delete", "this", "instanceof", "in", "of", "new",
  "class", "export", "default"
];

describe("IdentifierName property keys", () => {
  it.each(names)("supports %s in literal, binding, assignment, and parameter properties", async (name) => {
    const source = `
      const object = { ${name}: 7, extra: 2 };
      const { ${name}: bound, ...rest } = object;
      let assigned = 0;
      ({ ${name}: assigned } = object);
      function read({ ${name}: value = 3 }) { return value; }
      return [object.${name}, bound, assigned, rest.extra, read(object), read({})];
    `;
    const expected = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1_000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    expect(lint(source)).toEqual([]);
  });

  it.each(["null", "true", "false", "undefined", "return"])("represents %s as an identifier name, not a literal expression", (name) => {
    expect(parse(`({ ${name}: 1 })`)).toMatchObject({
      type: "ObjectExpression",
      properties: [{ computed: false, shorthand: false, key: { type: "Identifier", name } }]
    });
  });

  it("preserves numeric and string literal property semantics", async () => {
    const source = 'const object = { 0x10: 7, "null": 8 }; const { 16: value, "null": other } = object; return [value, other];';
    expect(await run(source)).toMatchObject({ ok: true, returnValue: [7, 8] });
  });

  it("accepts escaped keyword property names without changing references", async () => {
    const source = 'const object = { ret\\u0075rn: 7 }; const { ret\\u0075rn: value } = object; let assigned; ({ ret\\u0075rn: assigned } = object); return [object.return, value, assigned];';
    expect(runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1_000 })).toEqual([7, 7, 7]);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: [7, 7, 7] });
  });

  it.each(["return", "if", "for", "throw", "const", "import", "true", "false", "null"])("does not allow reserved %s as a binding or shorthand reference", (name) => {
    for (const source of [`const ${name} = 1;`, `return { ${name} };`, `const { ${name} } = {};`, `({ ${name} } = {});`]) {
      expect(() => runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1_000 })).toThrow();
      expect(() => parse(source)).toThrow();
    }
  });

  it("preserves legal contextual async shorthand bindings", async () => {
    expect(await run('const { async = 7 } = {}; const object = { async }; ({ async: object.value } = { async: 8 }); return [object.async, object.value];'))
      .toMatchObject({ ok: true, returnValue: [7, 8] });
  });

  it("replays the completed program with keyword data properties", async () => {
    const source = 'const object = { null: 7, return: 8 }; const { null: value } = object; return [value, object.return];';
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: [7, 8] });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) }))
      .toMatchObject({ ok: true, returnValue: [7, 8] });
  });
});
