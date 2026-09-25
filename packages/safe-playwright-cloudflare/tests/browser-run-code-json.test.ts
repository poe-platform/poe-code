import { expect, test, vi } from "vitest";
import { parseRunCodeJson } from "../src/browser-run-code-json.js";

const signal = () => new AbortController().signal;

test("accepts repeated guest references without an implicit allocation budget", () => {
  const json = JSON.stringify(Array(100_000).fill({}));
  expect(parseRunCodeJson(json, signal())).toEqual(Array(100_000).fill({}));
});

test.each([
  "[".repeat(65) + "0" + "]".repeat(65),
  JSON.stringify(Array(50_001).fill(null)),
  JSON.stringify("x".repeat(1024 * 1024)),
])("accepts large, wide and deeply nested JSON", (json) => {
  expect(parseRunCodeJson(json, signal())).toEqual(JSON.parse(json));
});

test("keeps strings, escapes, scalar results and ordinary nested results intact", () => {
  const value = { text: '[{},:]', escaped: '\\"', values: [null, true, 1, { a: "é" }] };
  expect(parseRunCodeJson(JSON.stringify(value), signal())).toEqual(value);
  expect(parseRunCodeJson("42", signal())).toBe(42);
  expect(parseRunCodeJson("null", signal())).toBeNull();
  expect(() => parseRunCodeJson('{"bad":}', signal())).toThrow(SyntaxError);
});

test("observes cancellation before parsing", () => {
  const abort = new AbortController();
  abort.abort(new Error("cancelled"));
  expect(() => parseRunCodeJson("[]", abort.signal)).toThrow("cancelled");
});

test("does not impose an implicit parsing deadline", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(101);
  const parse = vi.spyOn(JSON, "parse");
  try {
    expect(parseRunCodeJson("[]", signal())).toEqual([]);
    expect(parse).toHaveBeenCalledOnce();
  } finally { clock.mockRestore(); parse.mockRestore(); }
});

test("observes cancellation after native parsing", () => {
  const abort = new AbortController();
  const parse = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
    abort.abort(new Error("cancelled during parsing"));
    return [];
  });
  try {
    expect(() => parseRunCodeJson("[]", abort.signal)).toThrow("cancelled during parsing");
  } finally { parse.mockRestore(); }
});
