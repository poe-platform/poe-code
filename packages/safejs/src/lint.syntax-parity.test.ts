import { describe, expect, it } from "vitest";

import { dump } from "./dump.js";
import { lint } from "./lint/index.js";
import { run } from "./run.js";

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

describe("supported syntax lint parity", () => {
  it.each([
    { name: "sequence-expression reads", source: "const value = 1; return (value, 2);" },
    { name: "update-expression reads", source: "let value = 1; return value++;" },
    {
      name: "tagged-template reads",
      source:
        "const value = 42; function tag(parts, input) { return parts[0] + input; } return tag`value:${value}`;"
    },
    {
      name: "var redeclaration across blocks",
      source: "var value = 1; { var value = 2; } return value;"
    },
    {
      name: "var hoisting before initialization",
      source: "const before = typeof value; var value = 2; return [before, value];"
    },
    {
      name: "shared var loop captures",
      source:
        "const values = []; for (var index = 0; index < 3; index++) values.push(() => index); return values.map(read => read());"
    },
    {
      name: "var loop bindings after the loop",
      source: "for (var index = 0; index < 3; index++) { await 0; } return index;"
    },
    {
      name: "var declarations hoisted out of nested blocks",
      source: "const before = typeof value; if (true) { var value = 42; } return [before, value];"
    },
    {
      name: "var redeclarations sharing a function parameter",
      source: "function read(value) { var value; return value; } return read(42);"
    },
    {
      name: "switch fallthrough and default",
      source:
        "let result = 0; switch (2) { case 1: result = 1; break; case 2: result = 2; default: result += 3; } return result;"
    },
    {
      name: "method this receivers",
      source: "const object = { value: 42, read() { return this.value; } }; return object.read();"
    },
    {
      name: "lexical this inside a method's nested arrows",
      source:
        "const object = { value: 42, read() { return (() => () => this.value)()(); } }; return object.read();"
    },
    {
      name: "await in a top-level template interpolation",
      source: "if (true) { return `value:${await Promise.resolve(42)}`; }"
    },
    {
      name: "await in a catch binding default",
      source: "try { throw {}; } catch ({ value = await Promise.resolve(42) }) { return value; }"
    },
    {
      name: "await in a top-level if block",
      source: "if (true) { await Promise.resolve(); } return 42;"
    },
    {
      name: "await in a top-level loop block",
      source: "let count = 0; while (count < 3) { await Promise.resolve(); count++; } return count;"
    },
    {
      name: "await in top-level try and catch blocks",
      source:
        "try { await Promise.reject(1); } catch (error) { await Promise.resolve(); return error; }"
    },
    {
      name: "primitive await yielding to a promise reaction",
      source:
        "const events = []; Promise.resolve().then(() => events.push(1)); await 0; return events;"
    },
    {
      name: "synchronous generator iteration",
      source: "function* items() { yield 1; yield 2; } return Array.from(items());"
    }
  ])("accepts $name with native and replay semantics", async ({ source }) => {
    const expected = await new AsyncFunction(source)();
    const result = await run(source);
    expect(result).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: JSON.parse(await dump(result)) })).toMatchObject({
      ok: true,
      returnValue: expected
    });
    expect(lint(source)).toEqual([]);
  });

  it.each(["eval('1')", "new Function('return 1')", "with (value) {}"])(
    "retains host-escape restrictions for %s",
    (source) => {
      expect(lint(source)).toContainEqual(expect.objectContaining({ code: "AS001" }));
    }
  );

  it("retains the missing-async error inside a non-async function", () => {
    expect(lint("function read() { await Promise.resolve(); } read();")).toContainEqual(
      expect.objectContaining({ code: "AS-MISSING-ASYNC", severity: "error" })
    );
  });

  it.each(["return new Missing();", "switch (missing) { default: return 1; }"])(
    "detects unknown identifiers in supported syntax: %s",
    (source) => {
      expect(lint(source)).toContainEqual(expect.objectContaining({ code: "AS003" }));
    }
  );

  it("does not expose body vars to parameter default closures", () => {
    expect(
      lint("function read(get = () => hidden) { var hidden = 42; return get(); } return read();")
    ).toContainEqual(
      expect.objectContaining({ code: "AS003", message: expect.stringContaining("hidden") })
    );
  });
});
