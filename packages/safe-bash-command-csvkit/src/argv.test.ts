import assert from "node:assert/strict";
import { test } from "vitest";
import { OwnedArguments } from "./argv.js";

test("argv retains byte identity when caller buffers and returned views change", () => {
  const input = Uint8Array.of(0x61, 0xff);
  const other = Uint8Array.of(0x61, 0xfe);
  const argv = new OwnedArguments([input, other], { maxArguments: 2, maxArgumentBytes: 4 });
  input.fill(0);
  other.fill(0);
  const view = argv.bytes(0)!;
  view.fill(0);
  assert.deepEqual(argv.bytes(0), Uint8Array.of(0x61, 0xff));
  assert.deepEqual(argv.bytes(1), Uint8Array.of(0x61, 0xfe));
  assert.equal(argv.bytes(2), undefined);
});

test("argv admission rejects excessive count or total bytes before payload reads", () => {
  let read = false;
  const input = [Uint8Array.of(1), Uint8Array.of(2)];
  Object.defineProperty(input, 0, { get() { read = true; throw new Error("payload accessed"); } });
  assert.throws(() => new OwnedArguments(input, { maxArguments: 1, maxArgumentBytes: 2 }), RangeError);
  assert.equal(read, false);
  assert.throws(() => new OwnedArguments([Uint8Array.of(1, 2)], { maxArguments: 1, maxArgumentBytes: 1 }), RangeError);
  assert.throws(() => new OwnedArguments([], { maxArguments: -1, maxArgumentBytes: 1 }), RangeError);
});
