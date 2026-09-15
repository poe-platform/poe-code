import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

it("validates deep flat-source expression trees without host recursion",()=>{
  expect(parseExpression("x+".repeat(5000)+"x").kind).toBe("binary");
});

describe("comprehension assignment-expression validation", () => {
  it.each([
    "[(y := 1) for obj[y] in xs if (y := 2)]",
    "[x for obj[y] in xs if (y := 1) if (y := 2)]",
    "[x for obj[(y := 1)] in xs]", "[x for (obj := a).x in xs]",
    "[x for obj[(lambda a=(y := 1): a)()] in xs]",
    "[x for a in xs if (y := 1) for obj[y] in ys]",
    "[x for x in (y := xs)]",
    "[x for x in (lambda: (y := xs))()]",
    "[x for x in [(y := z) for z in zs]]",
    "[x for x in xs for y in (z := ys)]",
    "[(x := 1) for x in xs]",
    "[False and (x := 1) for x in xs]",
    "[x for x in xs if True or (x := 1)]",
    "[(y := 1) for x in xs for y in ys]",
    "[[(x := 1) for y in ys] for x in xs]",
    "[(lambda a=(x := 1): a) for x in xs]",
    "[(y := 1) for x, [y, *z] in xs]",
    "[(z := 1) for x, [y, *z] in xs]",
    "{(x := 1): y for x in xs}",
    "{y: (x := 1) for x in xs}",
    "f((x := 1) for x in xs)"
  ])("rejects %s", text => { expect(() => parseExpression(text)).toThrow(SyntaxError); });

  it.each([
    "[x for obj[(lambda: (y := 1))()] in xs]",
    "[x for a in xs if [(y := 1) for z in zs] for obj[y] in ys]",
    "[x for a in xs if (y := 1) if [x for obj[y] in ys]]",
    "[(y := 1) for a in xs for obj[y] in ys]",
    "[(y := x) for x in xs]", "[(lambda: (x := 1)) for x in xs]",
    "[(lambda: [(x := y) for y in ys]) for x in xs]",
    "[x for obj.x in xs if (obj := 1)]", "[x for obj[x] in xs if (x := 1)]",
    "[(x := 1) for obj.x in xs]", "[(x := 1), [x for x in xs]]",
    "([x for x in xs], (x := 1))", "[(x := 1) for y in ys], [x for x in xs]"
  ])("accepts %s", text => { expect(() => parseExpression(text)).not.toThrow(); });

  it("reports the assignment's location and source filename", () => {
    expect(() => parseExpression("[x for x in (y := xs)]", { filename: "example.py" })).toThrow(expect.objectContaining({ filename: "example.py", position: { offset: 13, line: 1, column: 13 } }));
  });
});
