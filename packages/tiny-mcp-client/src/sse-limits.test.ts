import { expect, it } from "vitest";
import { SseParser } from "./internal.js";

it("bounds an unterminated SSE line by UTF-8 bytes", () => {
  const parser = new SseParser(16);
  expect(() => parser.push("data: " + "😃".repeat(3))).toThrow("16 bytes");
});

it("bounds accumulated SSE data across individually short lines", () => {
  const parser = new SseParser(16);
  parser.push("data: 12345678\n");
  expect(() => parser.push("data: 12345678\n")).toThrow("16 bytes");
});

it("allows a long stream of separately bounded events", () => {
  const parser = new SseParser(16);
  const events = "data: 12345678\n\n".repeat(32);
  expect(parser.push(events)).toHaveLength(32);
});

it("does not accumulate SSE keepalive comments", () => {
  const parser = new SseParser(16);
  expect(parser.push(":ping\n".repeat(32))).toEqual([]);
  expect(parser.push("data: ok\n\n")).toEqual([{ data: "ok" }]);
});

it.each([0, -1, 1.5, Infinity])("rejects invalid SSE event byte limit %s", (limit) => {
  expect(() => new SseParser(limit)).toThrow("positive safe integer");
});
