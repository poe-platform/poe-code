import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

describe("Python primary expressions", () => {
  it("chains calls, attributes, and subscripts before arithmetic", () => {
    expect(parseExpression("-service.make(1).items[0] ** 2")).toMatchObject({
      kind: "unary", operand: { kind: "binary", operator: "**", left: {
        kind: "subscript", object: { kind: "attribute", spelling: "items", object: {
          kind: "call", callee: { kind: "attribute", object: { spelling: "service" }, spelling: "make" },
          arguments: [{ kind: "positional", value: { value: 1n } }]
        } }, items: [{ value: 0n }], tuple: false
      }, right: { value: 2n } }
    });
  });
  it("preserves positional, keyword, iterable, and mapping argument forms", () => {
    expect(parseExpression("f(1, *a, 2, x=3, *b, **c, y=4, **d,)")).toMatchObject({
      kind: "call", arguments: [
        { kind: "positional", value: { value: 1n } }, { kind: "starred", value: { spelling: "a" } },
        { kind: "positional", value: { value: 2n } }, { kind: "keyword", spelling: "x", value: { value: 3n } },
        { kind: "starred", value: { spelling: "b" } }, { kind: "mapping", value: { spelling: "c" } },
        { kind: "keyword", spelling: "y", value: { value: 4n } }, { kind: "mapping", value: { spelling: "d" } }
      ]
    });
    expect(parseExpression("f()()")).toMatchObject({ kind: "call", arguments: [], callee: { kind: "call", arguments: [] } });
  });
  it.each(["f(a=1, 2)", "f(**a, *b)", "f(**a, 2)", "f(a=1,a=2)", "f((a)=1)", "f(a.b=1)", "f(1=2)", "f(*a=1)", "f(,)", "f(a,,)"])(
    "rejects malformed call %s", (text) => { expect(() => parseExpression(text)).toThrow(SyntaxError); }
  );
  it("parses all slice components and omitted bounds", () => {
    expect(parseExpression("a[start:stop:step, :, ::-1, 3:, :4]")).toMatchObject({
      kind: "subscript", tuple: true, items: [
        { kind: "slice", lower: { spelling: "start" }, upper: { spelling: "stop" }, step: { spelling: "step" } },
        { kind: "slice", lower: null, upper: null, step: null },
        { kind: "slice", lower: null, upper: null, step: { kind: "unary", operator: "-", operand: { value: 1n } } },
        { kind: "slice", lower: { value: 3n }, upper: null, step: null },
        { kind: "slice", lower: null, upper: { value: 4n }, step: null }
      ]
    });
  });
  it("distinguishes scalar keys, trailing-comma tuples, and unpacked keys", () => {
    expect(parseExpression("a[x]")).toMatchObject({ kind: "subscript", tuple: false, items: [{ spelling: "x" }] });
    expect(parseExpression("a[x,]")).toMatchObject({ kind: "subscript", tuple: true, items: [{ spelling: "x" }] });
    expect(parseExpression("a[*xs]")).toMatchObject({ kind: "subscript", tuple: true, items: [{ kind: "unpack", value: { spelling: "xs" } }] });
  });
  it.each(["a[]", "a[:: :]", "a[x,,y]", "a[*x:y]", "a.", "a.if", "a.True", "a.1"])(
    "rejects malformed primary %s", (text) => { expect(() => parseExpression(text)).toThrow(SyntaxError); }
  );
  it("retains soft keywords as ordinary attribute names", () => {
    expect(parseExpression("a.match.case.type")).toMatchObject({ kind: "attribute", spelling: "type" });
  });
  it("supports conditional and boolean expressions within arguments and bounds", () => {
    expect(parseExpression("f(x if y else z)[a or b:c and d]")).toMatchObject({
      kind: "subscript", object: { arguments: [{ value: { kind: "conditional" } }] },
      items: [{ kind: "slice", lower: { kind: "boolean", operator: "or" }, upper: { kind: "boolean", operator: "and" } }]
    });
  });
});
