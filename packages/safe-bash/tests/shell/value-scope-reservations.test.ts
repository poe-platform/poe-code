import assert from "node:assert/strict";
import { test } from "node:test";
import { ValueArena } from "../../src/shell/value-state.js";
import { ShellLimitError } from "../../src/shell/types.js";

test("scope byte reservation grows one payload without per-increment records", context => {
  const arena = new ValueArena(8256, 1, () => {});
  const allocated = context.mock.method(arena, "allocate");
  const scope = arena.scope();
  for (let index = 0; index < 128; index++) scope.reserveBytes(64);
  assert.deepEqual(arena.usage, { bytes: 8256, slots: 1 });
  assert.equal(allocated.mock.callCount(), 2);
  assert.throws(() => scope.reserveBytes(1), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  assert.deepEqual(arena.usage, { bytes: 8256, slots: 1 });
  scope.close();
  scope.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
  assert.throws(() => scope.reserveBytes(0), /closed/u);
});

test("aggregate bytes share enrollment without changing independent reservation release", () => {
  const arena = new ValueArena(1024, 8, () => {});
  const first = arena.scope();
  const second = arena.scope();
  first.reserveBytes(8);
  const independent = first.reserve(16, 1);
  independent.commit({ retained: true });
  second.reserveBytes(32);
  assert.deepEqual(arena.usage, { bytes: 184, slots: 3 });
  independent.release();
  independent.release();
  assert.deepEqual(arena.usage, { bytes: 168, slots: 2 });
  first.close();
  assert.deepEqual(arena.usage, { bytes: 96, slots: 1 });
  second.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("aggregate bytes preserve zero-size admission, field limits, and failed initial cleanup", () => {
  for (const [bytes, slots, expected] of [[63, 1, "maxExpansionBytes"], [64, 0, "maxExpansionFields"], [64, 1, "maxExpansionBytes"]] as const) {
    const arena = new ValueArena(bytes, slots, () => {});
    const scope = arena.scope();
    assert.throws(() => scope.reserveBytes(1), error => error instanceof ShellLimitError && error.limit === expected);
    scope.close();
    assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
  }
  const arena = new ValueArena(64, 1, () => {});
  const scope = arena.scope();
  scope.reserveBytes(0);
  scope.reserveBytes(0);
  assert.deepEqual(arena.usage, { bytes: 64, slots: 1 });
  scope.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("invalid byte increments leave the cumulative charge unchanged", () => {
  const arena = new ValueArena(1024, 1, () => {});
  const scope = arena.scope();
  scope.reserveBytes(8);
  for (const bytes of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => scope.reserveBytes(bytes), RangeError);
    assert.deepEqual(arena.usage, { bytes: 72, slots: 1 });
  }
  scope.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("cancelled aggregate growth preserves charges until unconditional cleanup", () => {
  const controller = new AbortController();
  const reason = Object.freeze({ cancelled: "byte growth" });
  const arena = new ValueArena(1024, 1, () => controller.signal.throwIfAborted());
  const scope = arena.scope();
  scope.reserveBytes(8);
  controller.abort(reason);
  assert.throws(() => scope.reserveBytes(1), error => error === reason);
  assert.deepEqual(arena.usage, { bytes: 72, slots: 1 });
  scope.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("arena growth refuses foreign, released, and committed records", () => {
  const arena = new ValueArena(1024, 8, () => {});
  const foreign = new ValueArena(1024, 8, () => {});
  const released = arena.allocate(8, 0);
  arena.release(released);
  const committed = arena.allocate(8, 0);
  arena.commit(committed, {});
  const other = foreign.allocate(8, 0);
  for (const record of [other, released, committed]) assert.throws(() => arena.grow(record, 1), /reservation/u);
  assert.deepEqual(arena.usage, { bytes: 8, slots: 0 });
  arena.close();
  foreign.close();
});
