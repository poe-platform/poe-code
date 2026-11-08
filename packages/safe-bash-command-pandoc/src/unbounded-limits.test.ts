import { expect, it } from "vitest";
import { convert, createExecutionContext, defaultLimits } from "./index.js";

it("leaves every conversion budget unlimited unless explicitly configured", async () => {
  expect(Object.values(defaultLimits).every(value => value === Infinity)).toBe(true);
  const context = createExecutionContext("convert");
  context.charge("work", 1_000_001);
  context.bound("depth", 129);
  expect(context.remaining("work")).toBe(Infinity);
  const result = await convert([{ bytes: new TextEncoder().encode("Hello") }], {
    from: "commonmark", to: "html"
  }, { limits: { inputBytes: Infinity, nodes: Infinity, work: 2_000_000 } });
  expect(result).toMatchObject({ kind: "text", text: "<p>Hello</p>\n" });
});

it("accepts arbitrary finite budgets and keeps their boundary enforced", () => {
  const context = createExecutionContext("convert", { limits: { work: 2_000_000 } });
  context.charge("work", 2_000_000);
  expect(context.remaining("work")).toBe(0);
  expect(() => context.charge("work", 1)).toThrowError(expect.objectContaining({ code: "E_LIMIT" }));
});

it.each([-Infinity, NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid budget %s", value => {
  expect(() => createExecutionContext("convert", { limits: { work: value } }))
    .toThrowError(expect.objectContaining({ code: "E_OPTION" }));
});
