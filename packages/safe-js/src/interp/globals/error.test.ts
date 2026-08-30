import { describe, expect, it } from "vitest";

import { parse, type ParseResult } from "../../parse.js";
import { parseModule } from "../../parse/parser.js";
import { Budget } from "../budget.js";
import { interpret, type InterpreterValue } from "../interpreter.js";
import { createSandboxClosure, type SandboxClosure, type SandboxObject } from "../values.js";
import { createErrorGlobals } from "./error.js";

describe("createErrorGlobals", () => {
  it("creates subset error values with name, message, and sandbox-only stack", async () => {
    const globals = createErrorGlobals({
      budget: new Budget()
    });
    const error = getClosure(globals.Error);

    expect(
      error.call(["boom"], {
        stack: ["    at Error (script:1:1)"]
      })
    ).toEqual({
      message: "boom",
      name: "Error",
      stack: "Error: boom\n    at Error (script:1:1)"
    });
  });

  it("coerces non-string messages and defaults missing messages to the empty string", async () => {
    const globals = createErrorGlobals({
      budget: new Budget()
    });

    expect(getClosure(globals.TypeError).call([42], { stack: [] })).toEqual({
      message: "42",
      name: "TypeError",
      stack: "TypeError: 42"
    });
    expect(getClosure(globals.Error).call([], { stack: [] })).toEqual({
      message: "",
      name: "Error",
      stack: "Error"
    });
    expect(getClosure(globals.Error).call(["boom"])).toEqual({
      message: "boom",
      name: "Error",
      stack: "Error: boom"
    });
  });

  it("never includes host stack frames in produced stacks", async () => {
    const globals = createErrorGlobals({
      budget: new Budget()
    });
    const wrap = createSandboxClosure({
      name: "wrap",
      call: async (args, context) => getClosure(globals.Error).call(args, context)
    });

    const result = (await wrap.call(["nested"], {
      stack: ["    at wrap (script:2:1)"]
    })) as SandboxObject;

    expect(result.stack).toBe("Error: nested\n    at wrap (script:2:1)");
    expect(String(result.stack)).not.toContain("error.test.ts");
  });

  it("orders nested sandbox frames from innermost to outermost", async () => {
    const globals = createErrorGlobals({
      budget: new Budget()
    });

    expect(
      getClosure(globals.TypeError).call(["boom"], {
        stack: [
          "    at outer (line 1, column 1)",
          "    at inner (line 2, column 3)",
          "    at TypeError (line 3, column 5)"
        ]
      })
    ).toEqual({
      message: "boom",
      name: "TypeError",
      stack: [
        "TypeError: boom",
        "    at TypeError (line 3, column 5)",
        "    at inner (line 2, column 3)",
        "    at outer (line 1, column 1)"
      ].join("\n")
    });
  });

  it("applies the string budget to message and stack strings", async () => {
    const globals = createErrorGlobals({
      budget: new Budget({
        stringLength: 8
      })
    });

    expect(() => getClosure(globals.Error).call(["toolong"], { stack: [] })).toThrowError(
      expect.objectContaining({
        budget: "stringLength",
        current: 14,
        limit: 8
      })
    );
  });

  it.each([
    ["new Error()", "return new Error().message;", ""],
    ['new Error("msg")', 'return new Error("msg").message;', "msg"],
    ["new Error(123)", "return new Error(123).message;", "123"],
    ["new Error({ a: 1 })", "return new Error({ a: 1 }).message;", "[object Object]"],
    ["new Error(null)", "return new Error(null).message;", "null"],
    ['Error("msg")', 'return Error("msg").message;', "msg"]
  ])("matches message coercion for %s", async (_name, source, expected) => {
    await expect(run(source)).resolves.toBe(expected);
  });

  it("constructs TypeError values that are instances of TypeError and Error", async () => {
    await expect(
      run(
        'const err = new TypeError("x"); return [err.name, err instanceof TypeError, err instanceof Error];'
      )
    ).resolves.toEqual(["TypeError", true, true]);
  });

  it.each(["TypeError", "RangeError", "ReferenceError", "SyntaxError"])(
    "treats %s as an Error subclass",
    async (name) => {
      await expect(run(`const err = new ${name}("x"); return err instanceof Error;`)).resolves.toBe(
        true
      );
    }
  );

  it("treats Error values as Error instances", async () => {
    await expect(run('const err = new Error("x"); return err instanceof Error;')).resolves.toBe(
      true
    );
  });

  it("returns false for unrelated Error family constructors", async () => {
    await expect(run('const err = new Error("x"); return err instanceof TypeError;')).resolves.toBe(
      false
    );
  });

  it("keeps constructed error stacks limited to sandbox frames", async () => {
    const stack = await run('const make = () => new Error("sandbox"); return make().stack;');

    expect(stack).toContain("Error: sandbox");
    expect(stack).toContain("    at Error (line 1, column 20)");
    expect(stack).toContain("    at <anonymous> (line 1, column 49)");
    expect(String(stack)).not.toContain("error.test.ts");
  });

  it("preserves properties assigned after error construction", async () => {
    await expect(
      run('const err = new Error("x"); err.code = 123; return [err.message, err.code];')
    ).resolves.toEqual(["x", 123]);
  });

  it("supports Error cause options", async () => {
    await expect(
      run(
        'const cause = { code: 7 }; const err = new Error("x", { cause }); return err.cause === cause;'
      )
    ).resolves.toBe(true);
  });

  it("supports AggregateError with an errors array", async () => {
    await expect(
      run(
        'const err = new AggregateError(["a", "b"], "many"); return [err.name, err.message, err.errors];'
      )
    ).resolves.toEqual(["AggregateError", "many", ["a", "b"]]);
  });
});

function getClosure(value: unknown): SandboxClosure {
  return value as SandboxClosure;
}

async function run(source: string): Promise<InterpreterValue | undefined> {
  const budget = new Budget();
  const result = await interpret(parseScript(source), {
    bindings: createErrorGlobals({ budget }),
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
      body: module.body,
      span: module.span,
      type: "BlockStatement"
    };
  }
}
