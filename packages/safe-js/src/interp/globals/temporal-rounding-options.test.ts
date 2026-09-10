import { expect, it } from "vitest";
import { Budget } from "../budget.js";
import { readTemporalRoundingOptions } from "./temporal-rounding-options.js";

it.each([{}, {roundingIncrement:1,roundingMode:"ceil"}, {smallestUnit:undefined}])("rejects a missing required unit with RangeError: %j", async options => {
  await expect(readTemporalRoundingOptions(options,["day","hour"],new Budget())).rejects.toThrow(RangeError);
});

it.each([undefined,null,1,true])("rejects non-options %j with TypeError", async options => {
  await expect(readTemporalRoundingOptions(options,["hour"],new Budget())).rejects.toThrow(TypeError);
});

it("normalizes plural shorthand with only the caller's allowed units", async () => {
  expect(await readTemporalRoundingOptions("days",["day","hour"],new Budget())).toEqual({smallestUnit:"day"});
  await expect(readTemporalRoundingOptions("day",["hour"],new Budget())).rejects.toThrow(RangeError);
});

it("normalizes primitive options without imposing operation-specific increment rules", async () => {
  expect(await readTemporalRoundingOptions({smallestUnit:"hours",roundingIncrement:3.9,roundingMode:"halfEven"},["hour"],new Budget()))
    .toEqual({smallestUnit:"hour",roundingIncrement:3,roundingMode:"halfEven"});
});
