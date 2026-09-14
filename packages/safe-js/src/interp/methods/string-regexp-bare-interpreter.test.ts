import { expect, it } from "vitest";
import { parseModule } from "../../parse/parser.js";
import { run } from "../../run.js";
import { interpret } from "../interpreter.js";

it("splits with a regex literal when using the interpreter without installed globals", async () => {
  const parsed = parseModule("return 'abba'.split(/b+/)");
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }))
    .toMatchObject({ ok: true, returnValue: ["a", "a"] });
});

it.each(["delete RegExp.prototype[Symbol.split]", "RegExp.prototype[Symbol.split] = undefined"])(
  "preserves string fallback after %s", async change => {
    expect(await run(`${change}; return 'abba'.split(/b+/);`))
      .toMatchObject({ ok: true, returnValue: ["abba"] });
  }
);

it("respects an explicitly null regex prototype and its string conversion", async () => {
  expect(await run(`const r = /b+/; Object.setPrototypeOf(r, null);
    r.toString = () => 'b'; return 'abba'.split(r);`))
    .toMatchObject({ ok: true, returnValue: ["a", "", "a"] });
});
