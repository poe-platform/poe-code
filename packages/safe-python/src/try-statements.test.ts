import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("try statements", () => {
  it("preserves handler order, aliases, else, and finally", () => {
    expect(parseModule("try:\n work()\nexcept A as K:\n recover()\nexcept:\n raise\nelse: success()\nfinally: clean()\nafter()"))
      .toMatchObject({ body: [{ kind: "try", group: false, body: [{ kind: "expression-statement" }],
        handlers: [{ exception: { name: "A" }, alias: { name: "K", spelling: "K" } }, { exception: null, alias: null }],
        otherwise: [{ kind: "expression-statement" }], finalizer: [{ kind: "expression-statement" }] }, { kind: "expression-statement" }] });
  });

  it("parses group handlers and Python 3.14 unparenthesized exception lists", () => {
    expect(parseModule("try: pass\nexcept* A, B,: pass\nexcept* (C, D) as err: pass"))
      .toMatchObject({ body: [{ kind: "try", group: true, handlers: [
        { exception: { kind: "tuple", items: [{ name: "A" }, { name: "B" }] }, alias: null },
        { exception: { kind: "tuple" }, alias: { name: "err" } }
      ], otherwise: [], finalizer: [] }] });
  });

  it("keeps nested try/finally ownership correct", () => {
    expect(parseModule("try:\n try: pass\n finally: pass\nfinally: pass"))
      .toMatchObject({ body: [{ kind: "try", handlers: [], body: [{ kind: "try", handlers: [], finalizer: [{ kind: "pass" }] }], finalizer: [{ kind: "pass" }] }] });
  });

  it("validates expressions in handler types and every suite", () => {
    const bad = "[(x:=1) for x in xs]";
    for (const source of [`try: ${bad}\nexcept: pass`, `try: pass\nexcept ${bad}: pass`,
      `try: pass\nexcept: ${bad}`, `try: pass\nexcept: pass\nelse: ${bad}`, `try: pass\nfinally: ${bad}`]) {
      expect(() => parseModule(source)).toThrow(SyntaxError);
    }
  });

  it.each(["try: pass", "try: pass\nelse: pass", "try: pass\nexcept*: pass", "try: pass\nexcept: pass\nexcept A: pass",
    "try: pass\nexcept A: pass\nexcept* B: pass", "try: pass\nexcept* A: pass\nexcept B: pass",
    "try: pass\nexcept A,B as e: pass", "try: pass\nexcept A as __debug__: pass", "try: pass\nexcept A as obj.x: pass",
    "try: pass\nexcept A as if: pass", "try: pass\nexcept A as: pass", "try: pass\nexcept as e: pass",
    "try: pass\nfinally: pass\nexcept: pass", "try: pass\nexcept: pass\nelse: pass\nelse: pass",
    "try: pass\nexcept A: pass\nfinally:", "try: pass\nexcept A, *B: pass"])
    ("rejects invalid try statement %s", source => { expect(() => parseModule(source)).toThrow(SyntaxError); });
});
