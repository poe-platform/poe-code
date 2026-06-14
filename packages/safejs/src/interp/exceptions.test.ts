import { describe, expect, it, vi } from "vitest";

import { parse, type ParseResult } from "../parse.js";
import { parseModule } from "../parse/parser.js";
import { Budget } from "./budget.js";
import { createErrorGlobals } from "./globals/error.js";
import { createSandboxClosure } from "./values.js";
import { interpret, type InterpreterValue } from "./interpreter.js";
import { createPromiseGlobals } from "./promise.js";

describe("exceptions", () => {
  it.each([
    ['throw "string"', 'try { throw "string"; } catch (error) { return error; }', "string"],
    ["throw null", "try { throw null; } catch (error) { return error; }", null],
    ["throw undefined", "try { throw undefined; } catch (error) { return error; }", undefined],
    [
      "throw { code: 42 }",
      "try { throw { code: 42 }; } catch (error) { return error; }",
      {
        code: 42
      }
    ],
    ["throw 0", "try { throw 0; } catch (error) { return error; }", 0]
  ])("catches %s without wrapping", async (_name, source, expected) => {
    await expect(run(source)).resolves.toEqual(expected);
  });

  it('catches throw new Error("msg") as an Error-shaped value', async () => {
    await expect(
      run('try { throw new Error("msg"); } catch (error) { return error; }')
    ).resolves.toMatchObject({
      message: "msg",
      name: "Error"
    });
  });

  it("passes a thrown circular self-reference through catch unchanged", async () => {
    const circular = { self: undefined as unknown };
    circular.self = circular;

    await expect(
      run(
        "try { throw circular; } catch (error) { return error === circular && error.self === error; }",
        {
          circular: circular as InterpreterValue
        }
      )
    ).resolves.toBe(true);
  });

  it("preserves object identity when rethrowing", async () => {
    await expect(
      run(
        [
          "const marker = { code: 42 };",
          "try {",
          "  try {",
          "    throw marker;",
          "  } catch (error) {",
          "    throw error;",
          "  }",
          "} catch (outer) {",
          "  return outer === marker;",
          "}"
        ].join("\n")
      )
    ).resolves.toBe(true);
  });

  it("propagates throws from default parameter expressions at the call site", async () => {
    await expect(
      run(
        [
          "const marker = { code: 42 };",
          "const fn = (value = (() => { throw marker; })()) => value;",
          "try {",
          "  fn();",
          "} catch (error) {",
          "  return error.code;",
          "}"
        ].join("\n")
      )
    ).resolves.toBe(42);
  });

  it("propagates interpolation throws before constructing a tagged template call", async () => {
    const tag = vi.fn(() => "unused");

    await expect(
      run(
        'try { myTag`${(() => { throw "interpolation failed"; })()}`; } catch (error) { return error; }',
        {
          myTag: createSandboxClosure({
            call: tag,
            name: "myTag"
          })
        }
      )
    ).resolves.toBe("interpolation failed");

    expect(tag).not.toHaveBeenCalled();
  });

  it("runs catch blocks without introducing a catch binding when no binding is declared", async () => {
    await expect(
      run(
        [
          'let error = "outer";',
          "let ran = false;",
          'try { throw "boom"; } catch {',
          "  ran = true;",
          "}",
          "return [ran, error];"
        ].join("\n")
      )
    ).resolves.toEqual([true, "outer"]);
  });

  it("lets an outer try catch a nested inner throw", async () => {
    await expect(
      run('try { try { throw "inner"; } finally {} } catch (error) { return error; }')
    ).resolves.toBe("inner");
  });

  it("catches throws across an await boundary at the surrounding await", async () => {
    await expect(
      run(
        [
          "const marker = { code: 42 };",
          "const fn = async () => {",
          "  await Promise.resolve();",
          "  throw marker;",
          "};",
          "try {",
          "  await fn();",
          "} catch (error) {",
          "  return error.code;",
          "}"
        ].join("\n")
      )
    ).resolves.toBe(42);
  });
});

async function run(
  source: string,
  bindings: Record<string, InterpreterValue> = {}
): Promise<InterpreterValue | undefined> {
  const budget = new Budget();
  const result = await interpret(parseScript(source), {
    bindings: {
      ...createErrorGlobals({ budget }),
      ...createPromiseGlobals({ budget }),
      ...bindings
    },
    budget
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.returnValue;
}

function parseScript(source: string): ParseResult {
  try {
    return parse(source);
  } catch {
    const module = parseModule(source);
    return {
      type: "BlockStatement",
      body: module.body,
      span: module.span
    };
  }
}
