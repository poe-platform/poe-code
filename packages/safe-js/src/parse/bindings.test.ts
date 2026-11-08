import { describe, expect, it } from "vitest";

import { parseModule } from "./parser.js";
import { run } from "../run.js";

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

describe("declaration scope validation", () => {
  it.each([
    "const read = (value, value) => value;",
    "const read = (value, value) => { return value; };",
    "function read(value) { let value; }",
    "function read(value = 1) { const value = 2; }",
    "let value; { var value; }",
    "{ var value; let value; }",
    "{ let value; if (false) { var value; } }",
    "for (let value of [1]) { var value; }",
    "try { throw {}; } catch ({ value }) { var value; }",
    "try { throw 1; } catch (value) { let value; }",
    "{ function value() {} var value; }",
    "{ var value; function value() {} }"
  ])("rejects invalid lexical/var collisions before effects: %s", async (source) => {
      expect(() => new AsyncFunction(`"use strict"; ${source}`)).toThrow(SyntaxError);
    expect(() => parseModule(source)).toThrow();
    let effects = 0;
    await expect(
      run(`effect(); ${source}`, {
        bindings: {
          effect: () => {
            effects++;
          }
        }
      })
    ).rejects.toThrow();
    expect(effects).toBe(0);
  });

  it.each([
    "function read() { return 42; } var read; return read();",
    "function read() { return 1; } function read() { return 2; } return read();",
    "function read(value) { var value; return value; } return read(42);",
    "var value = 1; { let value = 2; value++; } return value;",
    "let value = 1; function read() { var value = 2; return value; } return [value, read()];",
    "var value = 1; try { throw 2; } catch (value) { var value = 3; } return value;",
    "for (var value of [1]) { let value = 2; value++; } return value;",
    "function read() { function value() { return 1; } function value() { return 2; } return value(); } return read();"
  ])("preserves valid shadowing and redeclarations: %s", async (source) => {
    const expected = await new AsyncFunction(`"use strict"; ${source}`)();
    expect(() => parseModule(source)).not.toThrow();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
