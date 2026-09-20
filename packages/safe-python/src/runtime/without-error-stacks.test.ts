import { expect, it } from "vitest";
import { withoutErrorStacks } from "../../tests/helpers/without-error-stacks.js";

it("restores stack capture after a synchronous oracle succeeds", () => {
  const previous = Error.stackTraceLimit;
  expect(withoutErrorStacks(() => Error.stackTraceLimit)).toBe(0);
  expect(Error.stackTraceLimit).toBe(previous);
});

it("restores stack capture and preserves the thrown reason when an oracle fails", () => {
  const previous = Error.stackTraceLimit;
  const reason = new Error("oracle failed");
  let caught: unknown;
  try {
    withoutErrorStacks(() => { throw reason; });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(reason);
  expect(Error.stackTraceLimit).toBe(previous);
});
