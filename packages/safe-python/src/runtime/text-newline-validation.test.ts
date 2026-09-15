import {describe, expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {Utf8TextDecoder} from "./utf8-text-decoder.js";
import {encodeUtf8Text} from "./utf8-text-encode.js";

function text(value: string): CodePointString {
  return new CodePointString(Uint32Array.from(value, point => point.codePointAt(0)!));
}

describe.each(["read", "write"] as const)("%s newline validation", direction => {
  const validate = (newline: string) => direction === "read"
    ? new Utf8TextDecoder(newline)
    : encodeUtf8Text(text(""), {newline});

  it.each(["x", "x\n", "é", "\r\r"])("retains the invalid value %j in the diagnostic", newline => {
    expect(() => validate(newline)).toThrow(expect.objectContaining({
      name: "ValueError", message: `illegal newline value: ${newline}`
    }));
  });

  it.each(["\0", "x\0", "\r\n\0"])("rejects an embedded NUL before newline validation (%j)", newline => {
    expect(() => validate(newline)).toThrow(expect.objectContaining({
      name: "ValueError", message: "embedded null character"
    }));
  });

  it.each([["\ud800", 0, 1], ["\0\ud800", 1, 2], ["\ud800\0", 0, 1], ["😀\ud800\ud801z", 1, 3]] as const)(
    "validates UTF-8 before NUL and newline checks (%j)", (newline, start, end) => {
      let failure: unknown;
      try {validate(newline);} catch (error) {failure = error;}
      expect(failure).toMatchObject({
        name: "UnicodeEncodeError", encoding: "utf-8", start, end, reason: "surrogates not allowed",
      });
      expect([...(failure as {object: CodePointString}).object]).toEqual([...text(newline)]);
    }
  );
});

it.each(["bad", "\0", "\ud800"])("meters read configuration rejection (%j)", newline => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 0});
  expect(() => new Utf8TextDecoder(newline, "strict", meter)).toThrow(ExecutionLimitError);
  expect(() => new Utf8TextDecoder(null, "strict", meter)).toThrow(ExecutionLimitError);
});

it.each(["bad", "\0", "\ud800"])("cancellation precedes read and write configuration errors (%j)", newline => {
  const controller = new AbortController();
  controller.abort();
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 1000, signal: controller.signal});
  expect(() => new Utf8TextDecoder(newline, "strict", meter)).toThrow(expect.objectContaining({reason: "cancelled"}));
  expect(() => encodeUtf8Text(text(""), {newline}, meter)).toThrow(expect.objectContaining({reason: "cancelled"}));
});

it("admits invalid newline diagnostics before they escape write preparation", () => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 0});
  const input = text("untouched");
  expect(() => encodeUtf8Text(input, {newline: "bad"}, meter)).toThrow(ExecutionLimitError);
  expect(() => encodeUtf8Text(input, {}, meter)).toThrow(ExecutionLimitError);
  expect([...input]).toEqual([...text("untouched")]);
});
