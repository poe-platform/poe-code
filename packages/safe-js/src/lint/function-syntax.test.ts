import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { run } from "../run.js";
import { lint } from "./index.js";

describe("function syntax", () => {
  it.each([
    "function compare(left, right) { return left - right; } return [3, 1, 2].sort(compare);",
    "return [3, 1, 2].sort(function (left, right) { return left - right; });",
    "return [3, 1, 2].sort(function (left, right) { return String(left - right); });",
    "return count(8); function count(value) { return value === 0 ? 0 : 1 + count(value - 1); }",
    "const factorial = function recur(value) { return value < 2 ? 1 : value * recur(value - 1); }; return factorial(6);",
    "function outer(value) { function inner() { return value + 1; } return inner(); } return outer(4);",
    "async function read(value) { return await Promise.resolve(value); } return await read(5);",
    "const read = async function (value) { return await Promise.resolve(value); }; return await read(5);",
    "function read({ value = 5 } = {}, ...rest) { return [value, rest]; } return read({}, 6, 7);",
    "function* values() { yield 1; yield 2; } return Array.from(values());",
    "let count = 0; const increment = function () { count += 1; }; increment(); return count;"
  ])("lints and runs like native JavaScript: %s", async (source) => {
    const expected = structuredClone(
      await runInNewContext(`(async () => { "use strict"; ${source} })()`)
    );
    expect(lint(source).filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "export default function (frontmatter) { return frontmatter.value; }",
    "export default async function (frontmatter) { return await Promise.resolve(frontmatter.value); }"
  ])("accepts function entry points: %s", async (source) => {
    expect(
      lint(source, { defaultExport: { parameters: ["frontmatter"], required: true } }).filter(
        (diagnostic) => diagnostic.severity === "error"
      )
    ).toEqual([]);
    await expect(run(source, { entryPointArgs: [{ value: 5 }] })).resolves.toMatchObject({
      ok: true,
      returnValue: 5
    });
  });

  describe.each([
    {
      name: "declaration",
      wrap: (body: string) => `function handler(value) { ${body} } handler(1);`
    },
    {
      name: "expression",
      wrap: (body: string) => `const handler = function (value) { ${body} }; handler(1);`
    },
    {
      name: "named expression",
      wrap: (body: string) => `const handler = function inner(value) { ${body} }; handler(1);`
    }
  ])("diagnostics inside $name", ({ wrap }) => {
    it.each([
      ["return missing;", "AS003"],
      ["const unused = 1; return value;", "AS007"],
      ["return value; missing;", "AS-UNREACHABLE"],
      ["return await Promise.resolve(value);", "AS-MISSING-ASYNC"],
      ["return `${value}`;", "AS-NEEDLESS-TEMPLATE"]
    ])("visits %s for %s", (body, code) => {
      const diagnostics = lint(wrap(body));
      expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("AS001");
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
    });

    it("recognizes references to imported names inside functions", () => {
      const source = `import { read } from "test"; ${wrap("return read(value);")}`;
      expect(lint(source, { modules: { test: ["read"] } })).toEqual([]);
    });
  });

  it("keeps named-expression bindings local to their functions", () => {
    const diagnostics = lint(
      "const handler = function inner() { return inner; }; handler(); inner;"
    );
    expect(diagnostics.filter((diagnostic) => diagnostic.code === "AS003")).toMatchObject([
      { message: expect.stringContaining("inner") }
    ]);
  });

  it.each([
    "function* values() { yield missing; } return values();",
    "const values = function* () { yield missing; }; return values();",
    "function read(value = missing) { return value; } return read();",
    "const read = function (value = missing) { return value; }; return read();"
  ])("checks yielded expressions and parameter defaults: %s", (source) => {
    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS003");
  });

  it.each([
    "async function task() { return await Promise.resolve(1); } task();",
    "const task = async function () { return await Promise.resolve(1); }; task();"
  ])("detects unhandled promise-returning function calls: %s", (source) => {
    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-FLOATING-PROMISE");
  });

  it("does not mistake a local function for an imported asynchronous operation", () => {
    const source = `
      import { task } from "test";
      function outer() {
        function task() { return 1; }
        task();
      }
      outer();
    `;
    const codes = lint(source, {
      modules: { test: { exports: ["task"], asyncExports: ["task"] } }
    }).map((diagnostic) => diagnostic.code);
    expect(codes).toContain("AS-UNUSED-IMPORT");
    expect(codes).not.toContain("AS-FLOATING-PROMISE");
  });

  it("keeps async default function entry points async when no await is needed", () => {
    const source = "export default async function (frontmatter) { return frontmatter; }";
    expect(lint(source).map((diagnostic) => diagnostic.code)).not.toContain("AS-ASYNC-NOT-NEEDED");
  });

  it("reports declarations and named expressions shadowing runtime globals", () => {
    expect(
      lint("function Math() { return 1; } Math();").map((diagnostic) => diagnostic.code)
    ).toContain("AS-SHADOW-GLOBAL");
    expect(
      lint("const read = function JSON() { return JSON; }; read();").map(
        (diagnostic) => diagnostic.code
      )
    ).toContain("AS-SHADOW-GLOBAL");
  });
});
