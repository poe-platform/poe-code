import { expect, it } from "vitest";
import { SseParser } from "./internal.js";

it.each(["data: unfinished", "data: unfinished\n", "data: unfinished\r"])("discards incomplete SSE events at EOF %j", (data) => {
  const parser = new SseParser();
  expect(parser.push(data)).toEqual([]);
  expect(parser.flush()).toEqual([]);
});
it("supports carriage-return-only event framing", () => {
  const parser = new SseParser();
  expect(parser.push("data: first\r\rdata: second\r\r")).toEqual([{ data: "first" }, { data: "second" }]);
});
it("treats CRLF split across chunks as one line ending", () => {
  const parser = new SseParser();
  expect(parser.push("data: first\r")).toEqual([]);
  expect(parser.push("\n\r")).toEqual([{ data: "first" }]);
  expect(parser.push("\ndata: second\r\n\r\n")).toEqual([{ data: "second" }]);
});
it("does not advance the reconnect cursor for an incomplete event", () => {
  const parser = new SseParser();
  parser.push("id: completed\ndata: first\n\n");
  parser.push("id: unseen\ndata: partial\n");
  parser.flush();
  expect(parser.lastEventId).toBe("completed");
});
