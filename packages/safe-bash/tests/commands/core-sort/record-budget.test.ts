import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { SortRecordBudget } from "../../../src/commands/sort-admission.js";

function isBufferLimit(error: unknown): boolean {
  return error instanceof FsError && error.code === "EFBIG" && error.message.includes("sort buffer limit exceeded");
}

test("sort enforces an explicit 100000 record quota, including empty records", () => {
  const budget = new SortRecordBudget(100_000);
  for (let index = 0; index < 100_000; index++) budget.admit(0);
  assert.throws(() => budget.admit(0), isBufferLimit);
  assert.throws(() => budget.admit(0), isBufferLimit);
});

test("sort enforces an explicit 32 MiB quota including one delimiter per record", () => {
  const budget = new SortRecordBudget(Infinity, 32 * 1024 * 1024);
  budget.admit(32 * 1024 * 1024 - 3);
  budget.admit(1);
  assert.throws(() => budget.admit(0), isBufferLimit);
});

test("sort rejected byte admission changes neither byte nor record accounting", () => {
  const budget = new SortRecordBudget(100_000, 32 * 1024 * 1024);
  budget.admit(32 * 1024 * 1024 - 100_000);
  assert.throws(() => budget.admit(100_000), isBufferLimit);
  for (let index = 1; index < 100_000; index++) budget.admit(0);
  assert.throws(() => budget.admit(0), isBufferLimit);
});

test("sort rejects one oversized logical record before consuming its first slot", () => {
  const budget = new SortRecordBudget(Infinity, 32 * 1024 * 1024);
  assert.throws(() => budget.admit(32 * 1024 * 1024), isBufferLimit);
  budget.admit(32 * 1024 * 1024 - 1);
  assert.throws(() => budget.admit(0), isBufferLimit);
});

test("sort record admission is independent for subsequent invocations", () => {
  const first = new SortRecordBudget(Infinity, 32 * 1024 * 1024);
  first.admit(32 * 1024 * 1024 - 1);
  assert.throws(() => first.admit(0), isBufferLimit);
  const second = new SortRecordBudget(Infinity, 32 * 1024 * 1024);
  second.admit(0);
  second.admit(32 * 1024 * 1024 - 2);
});
