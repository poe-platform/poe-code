import { expect, it, vi } from "vitest";

vi.mock("node:util", () => { throw new Error("Node util is unavailable in this host"); });

it("copies native dates through their intrinsic brand without reading spoofed tags or proxy traps", async () => {
  const { copyNativeDate, dateTime } = await import("./date.js");
  const date = new Date(1234);
  const copy = copyNativeDate(date)!;
  expect(copy).not.toBe(date);
  expect(dateTime(copy)).toBe(1234);
  expect(Number.isNaN(dateTime(copyNativeDate(new Date(NaN))!))).toBe(true);
  const tag = vi.fn(() => { throw new Error("Spoofed tag read"); });
  const fake = Object.defineProperty({}, Symbol.toStringTag, { get: tag });
  const trap = vi.fn(() => { throw new Error("Proxy trap invoked"); });
  expect(copyNativeDate(fake)).toBeUndefined();
  expect(copyNativeDate(new Proxy(date, { get: trap, getPrototypeOf: trap }))).toBeUndefined();
  for (const value of [null, undefined, 1, "date", true]) expect(copyNativeDate(value)).toBeUndefined();
  expect(tag).not.toHaveBeenCalled();
  expect(trap).not.toHaveBeenCalled();
  expect(() => copyNativeDate(new (class extends Date {})())).toThrow("Date subclasses are not supported.");
});
