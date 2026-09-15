import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

describe("comprehension yield restrictions", () => {
  it.each([
    "[(yield x) for x in xs]", "{(yield x) for x in xs}", "((yield x) for x in xs)",
    "{(yield x): x for x in xs}", "{x: (yield x) for x in xs}",
    "[(yield from x) for x in xs]", "[x for x in xs if (yield x)]",
    "[x for obj[(yield y)] in xs]", "[x for x in xs for y in (yield ys)]",
    "[(lambda a=(yield x): a) for x in xs]", "[[x for x in (yield xs)] for z in zs]",
    '[f"{yield x}" for x in xs]', '[f"{x:{yield w}}" for x in xs]'
  ])("rejects suspension in the implicit scope: %s", text => {
    expect(() => parseExpression(text)).toThrow(SyntaxError);
  });

  it.each([
    "[x for x in (yield xs)]", "[x for x in (yield from xs)]", "(x for x in (yield xs))",
    "[(lambda: (yield x)) for x in xs]", "[x for x in (lambda: (yield xs))()]",
    "[(lambda: [x for x in (yield xs)]) for z in zs]",
    "[x for x in (lambda a=(yield xs): a)()]"
  ])("allows suspension in the containing or explicit function scope: %s", text => {
    expect(() => parseExpression(text)).not.toThrow();
  });
});
