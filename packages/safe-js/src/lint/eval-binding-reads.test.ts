import { describe, expect, it } from "vitest";
import { AS006_007 } from "./rules/AS006-007.js";

describe("direct eval binding reads", () => {
  it.each([
    'const value = 2; return eval("value");',
    'const value = 2; return (eval)("value");',
    'const value = 2; return (() => eval("value"))();',
    'const value = 2; const source = "value"; return eval(source);'
  ])("does not claim visible bindings are unread: %s", source => {
    expect(AS006_007(source)).toEqual([]);
  });

  it.each([
    'const value = 2; return (0, eval)("value");',
    'const value = 2; return eval?.("value");',
    'const value = 2; return new Function("return value")();',
    'const value = 2; return eval();',
    'const value = 2; { const value = 3; eval("value"); }'
  ])("retains warnings when eval cannot read the binding: %s", source => {
    expect(AS006_007(source)).toEqual([
      expect.objectContaining({ code: "AS007", message: "Binding 'value' is declared but never read.", column: 7 })
    ]);
  });
});
