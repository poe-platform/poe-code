import assert from "node:assert/strict";
import test from "node:test";
import { ByteInputBudget, resolveInputLimit } from "../../../src/commands/bytes/input-budget.js";

const signal = new AbortController().signal;

test("encoding and checksum inputs have no omitted quota", async () => {
  assert.equal(resolveInputLimit({}), Infinity);
  assert.equal(resolveInputLimit({ limits: {} }), Infinity);
  const chunk = new Uint8Array(32 * 1024 * 1024 + 1);
  const budget = new ByteInputBudget(resolveInputLimit({}));
  for await (const result of budget.read((async function* () { yield chunk; })(), signal)) assert.equal(result, chunk);
});

test("encoding and checksum inputs honor explicit cumulative and zero quotas", async () => {
  assert.equal(resolveInputLimit({ limits: { maxInputBytes: 64 * 1024 * 1024 } }), 64 * 1024 * 1024);
  const budget = new ByteInputBudget(resolveInputLimit({ limits: { maxInputBytes: 3 } }));
  await assert.rejects(async () => {
    for await (const chunk of budget.read((async function* () { yield Uint8Array.of(1, 2); yield Uint8Array.of(3, 4); })(), signal)) assert.equal(chunk.length, 2);
  }, /input limit exceeded/);
  const empty = new ByteInputBudget(resolveInputLimit({ limits: { maxInputBytes: 0 } }));
  await assert.rejects(async () => {
    for await (const chunk of empty.read((async function* () { yield Uint8Array.of(1); })(), signal)) assert.fail(String(chunk));
  }, /input limit exceeded/);
});

for (const maxInputBytes of [-1, Infinity, NaN, 1.5]) {
  test(`explicit byte input quota must be a nonnegative safe integer: ${maxInputBytes}`, () => {
    assert.throws(() => resolveInputLimit({ limits: { maxInputBytes } }), /nonnegative safe integer/);
  });
}
