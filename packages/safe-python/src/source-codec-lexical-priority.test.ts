import {expect, it} from "vitest";
import {parseExpression} from "./expression.js";
import {parseModule} from "./module.js";
import {ExecutionBudget, ExecutionLimitError} from "./runtime/execution-budget.js";

it.each([parseExpression, parseModule])("%s retains failures from tokenizer callbacks after a grammar error", parse => {
  const failure = new Error("comment service failed");
  let calls = 0;
  expect(() => parse("x =\n# later comment\n\ufeff", {onComment() {calls++; throw failure;}})).toThrow(failure);
  expect(calls).toBe(1);
});

it.each([parseExpression, parseModule].flatMap(parse => [false, true].map(throws => ({parse, throws}))))(
  "$parse tokenizer completion keeps cancellation terminal (throws=$throws)", ({parse, throws}) => {
    const controller = new AbortController();
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal});
    let calls = 0;
    let failure: unknown;
    try {
      parse("x =\n# later comment\n\ufeff", {meter, onComment() {
        calls++;
        controller.abort();
        if (throws) throw Error("comment service failed");
      }});
    } catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "cancelled"});
    expect(calls).toBe(1);
    let retry: unknown;
    try {parse("1", {meter});} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect(calls).toBe(1);
  }
);

it.each([String.raw`x = "\q"`, String.raw`x = b"\q"`, String.raw`x = f"\q"`, String.raw`x = t"\q"`, String.raw`x = "\777"`])(
  "tokenizer completion does not decode or warn for discarded literal %s", source => {
    const warnings: string[] = [];
    expect(() => parseExpression(source, {onWarning(message) {warnings.push(message);}})).toThrow("invalid syntax");
    expect(warnings).toEqual([]);
  }
);
