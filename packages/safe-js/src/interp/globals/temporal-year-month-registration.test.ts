import { expect, it, vi } from "vitest";
import { Budget } from "../budget.js";
import * as objectModel from "../object-model.js";
import { createTemporalPlainYearMonthConstructor } from "./temporal-plain-year-month.js";

it("registers each YearMonth intrinsic function once", () => {
  const registration = vi.spyOn(objectModel, "registerIntrinsicFunction");
  try {
    createTemporalPlainYearMonthConstructor(new Budget(), Object.create(null), Object.create(null), Object.create(null));
    const functions = registration.mock.calls.map(([, fn]) => fn);
    expect(functions.length).toBeGreaterThan(0);
    expect(new Set(functions).size).toBe(functions.length);
  } finally { registration.mockRestore(); }
});
