import { expect, it } from "vitest";
import { validateChartObjectUpdates } from "./chart-object-operations.js";

it("rejects accessor array entries before invoking user code", () => {
  let invoked = false;
  const input: unknown[] = [];
  Object.defineProperty(input, "0", {
    enumerable: true,
    get() {
      invoked = true;
      return { target: "chart", hasTitle: true };
    }
  });
  expect(() => validateChartObjectUpdates(input)).toThrow();
  expect(invoked).toBe(false);
});

it("rejects custom iteration before invoking user code", () => {
  let invoked = false;
  const input = [{ target: "chart", hasTitle: true }];
  Object.defineProperty(input, Symbol.iterator, {
    value() {
      invoked = true;
      return [][Symbol.iterator]();
    }
  });
  expect(() => validateChartObjectUpdates(input)).toThrow();
  expect(invoked).toBe(false);
});

it("rejects nonenumerable update fields instead of admitting unvalidated mutations", () => {
  const edit = { target: "chart", hasTitle: true };
  Object.defineProperty(edit, "style", { value: 999 });
  expect(() => validateChartObjectUpdates([edit])).toThrow();
});
