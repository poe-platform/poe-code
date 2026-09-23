import { expect, test, vi } from "vitest";
import { parseRunCodeJson } from "../src/browser-run-code-json.js";

const signal = () => new AbortController().signal;

test("rejects repeated guest references under the 16 MiB byte cap before native parsing", () => {
  const json = JSON.stringify(Array(100_000).fill({}));
  expect(new TextEncoder().encode(json).byteLength).toBeLessThan(16 * 1024 * 1024);
  const parse = vi.spyOn(JSON, "parse");
  try {
    expect(() => parseRunCodeJson(json, signal())).toThrow("Run-code JSON structure limit exceeded");
    expect(parse).not.toHaveBeenCalled();
  } finally { parse.mockRestore(); }
});

test.each([
  "[".repeat(65) + "0" + "]".repeat(65),
  JSON.stringify(Array(50_001).fill(null)),
  JSON.stringify("x".repeat(1024 * 1024)),
])("rejects excessive nesting, slots or scan work", (json) => {
  expect(() => parseRunCodeJson(json, signal())).toThrow("Run-code JSON");
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

test("rejects a scan that exhausts its deadline before native parsing", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(101);
  const parse = vi.spyOn(JSON, "parse");
  try {
    expect(() => parseRunCodeJson("[]", signal())).toThrow("Run-code JSON scan deadline exceeded");
    expect(parse).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); parse.mockRestore(); }
});
