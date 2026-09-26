import assert from "node:assert/strict";
import test from "node:test";
import { CsvBudget, CsvError, defaultCsvLimits, type CsvLimits } from "./index.js";

for (const key of Object.keys(defaultCsvLimits) as (keyof CsvLimits)[]) {
  test(`CSV ${key} is unlimited by default with optional finite enforcement`, () => {
    const signal = new AbortController().signal;
    const defaults = new CsvBudget({}, signal);
    assert.equal(defaults.limits[key], Infinity);
    assert.doesNotThrow(() => defaults.charge(key, 268_435_456));
    const explicit = new CsvBudget({ [key]: Infinity }, signal);
    assert.doesNotThrow(() => explicit.charge(key, 268_435_456));
    const finite = new CsvBudget({ [key]: 3 }, signal);
    assert.throws(() => finite.charge(key, 4), CsvError);
    for (const value of [-1, -Infinity, NaN, 0.5]) assert.throws(() => new CsvBudget({ [key]: value }, signal), CsvError);
  });
}
