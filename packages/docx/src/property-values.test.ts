import { expect, it } from "vitest";
it("normalizes fractional UTC instants before and after the epoch to whole seconds", async () => {
  const { normalizePropertyDate } = await import("./property-values.js");
  expect(normalizePropertyDate("1969-12-31T23:59:59.999Z")).toBe("1969-12-31T23:59:59Z");
  expect(normalizePropertyDate("2024-02-29T12:34:56.123Z")).toBe("2024-02-29T12:34:56Z");
  expect(() => normalizePropertyDate("2025-02-29T00:00:00Z")).toThrow();
});
