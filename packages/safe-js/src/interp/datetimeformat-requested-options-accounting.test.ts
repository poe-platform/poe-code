import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxDateTimeFormat, dateTimeFormatState } from "./intl-datetimeformat.js";
import { measureSandboxData } from "./values.js";

it("charges retained requested options alongside resolved options", () => {
  const formatter = createSandboxDateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", hourCycle: "h23" });
  const state = dateTimeFormatState(formatter);
  expect(state.requestedOptions).toEqual({ timeZone: "UTC", hour: "numeric", hourCycle: "h23" });
  const expected = 1 + measureSandboxData([state.options, state.requestedOptions]);
  expect(measureSandboxData([formatter])).toBe(expected);
  expect(measureSandboxData([formatter, formatter, state.options, state.requestedOptions])).toBe(expected);
  expect(() => new Budget({ dataSize: expected }).reconcileDataUsage(measureSandboxData([formatter]))).not.toThrow();
  expect(() => new Budget({ dataSize: expected - 1 }).reconcileDataUsage(measureSandboxData([formatter]))).toThrow();
});

it("preserves accounting for older restored formatters without requested options", () => {
  const source = createSandboxDateTimeFormat("en-US", { timeZone: "UTC" });
  const formatter = createSandboxDateTimeFormat("en-US", dateTimeFormatState(source).options, true);
  const state = dateTimeFormatState(formatter);
  expect(state.requestedOptions).toBeUndefined();
  expect(measureSandboxData([formatter])).toBe(1 + measureSandboxData([state.options]));
});
