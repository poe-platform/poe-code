import { expect, it } from "vitest";
import { Budget } from "./budget.js";

it("keeps a compilation owner stable across sequential entries in one generation", () => {
  const budget = new Budget();
  const first = budget.acquireCompileOwner();
  first.release();
  const second = budget.acquireCompileOwner();
  expect(second.owner).toBe(first.owner);
  const nested = budget.acquireCompileOwner(false, first.owner);
  nested.release();
  second.release();
});

it("still refuses independent concurrent entry and invalidates old owners on reset", () => {
  const budget = new Budget();
  const first = budget.acquireCompileOwner();
  expect(() => budget.acquireCompileOwner()).toThrow("already running");
  expect(() => new Budget().acquireCompileOwner(false, first.owner)).toThrow("already running");
  first.release();
  const next = budget.acquireCompileOwner(true);
  expect(next.owner).not.toBe(first.owner);
  expect(() => budget.acquireCompileOwner(false, first.owner)).toThrow("already running");
  next.release();
});
