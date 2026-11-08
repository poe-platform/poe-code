import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { readDurationRecord } from "./intl-duration-record.js";
import { createSandboxClosure, type SandboxValue } from "./values.js";

it.each([1n, Symbol(), 1.5, Infinity, NaN])("rejects invalid duration field %s", async seconds => {
  await expect(readDurationRecord({ seconds }, new Budget())).rejects.toBeInstanceOf(
    typeof seconds === "bigint" || typeof seconds === "symbol" ? TypeError : RangeError);
});

it.each([{}, null, undefined, 3, true])("rejects invalid or empty duration input %s", async value => {
  await expect(readDurationRecord(value, new Budget())).rejects.toBeInstanceOf(TypeError);
});

it("rejects duration strings with RangeError", async () => {
  await expect(readDurationRecord("PT1S", new Budget())).rejects.toBeInstanceOf(RangeError);
});

it.each([
  { years: 2 ** 32 }, { months: -(2 ** 32) }, { weeks: 2 ** 32 },
  { seconds: 2 ** 53 }, { seconds: Number.MAX_SAFE_INTEGER, milliseconds: 1000 },
  { hours: 1, minutes: -1 }
])("rejects an out-of-range or mixed-sign record %j", async value => {
  await expect(readDurationRecord(value, new Budget())).rejects.toBeInstanceOf(RangeError);
});

it("retains exact normalized seconds below the limit", async () => {
  const value = { seconds: Number.MAX_SAFE_INTEGER, milliseconds: 999, microseconds: 999, nanoseconds: 999 };
  expect(await readDurationRecord(value, new Budget())).toMatchObject(value);
});

it("reads each field once in alphabetical order and accepts callable guest objects", async () => {
  const input = createSandboxClosure({ name: "duration", call: () => undefined });
  const trace: string[] = [];
  const result = await readDurationRecord(input, new Budget(), {
    stack: [], getProperty: async (_value: SandboxValue, key: string | symbol) => {
      trace.push(String(key));
      return key === "seconds" ? "2" : undefined;
    }
  });
  expect(result.seconds).toBe(2);
  expect(trace).toEqual(["days", "hours", "microseconds", "milliseconds", "minutes", "months", "nanoseconds", "seconds", "weeks", "years"]);
});

it("stops immediately after failed field coercion", async () => {
  const trace: string[] = [];
  await expect(readDurationRecord({}, new Budget(), {
    stack: [], getProperty: async (_value, key) => {
      trace.push(String(key));
      return key === "hours" ? 1n : undefined;
    }
  })).rejects.toBeInstanceOf(TypeError);
  expect(trace).toEqual(["days", "hours"]);
});

it("validates record signs only after reading all fields", async () => {
  const trace: string[] = [];
  await expect(readDurationRecord({}, new Budget(), {
    stack: [], getProperty: async (_value, key) => {
      trace.push(String(key));
      return key === "days" ? 1 : key === "hours" ? -1 : undefined;
    }
  })).rejects.toBeInstanceOf(RangeError);
  expect(trace).toHaveLength(10);
  expect(trace.at(-1)).toBe("years");
});

it("normalizes negative zero and accepts the negative lower-bound neighbor", async () => {
  expect(Object.is((await readDurationRecord({ seconds: -0 }, new Budget())).seconds, -0)).toBe(false);
  const value = { seconds: -Number.MAX_SAFE_INTEGER, milliseconds: -999, microseconds: -999, nanoseconds: -999 };
  expect(await readDurationRecord(value, new Budget())).toMatchObject(value);
});
