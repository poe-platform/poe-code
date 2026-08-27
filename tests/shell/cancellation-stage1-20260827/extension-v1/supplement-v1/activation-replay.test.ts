import assert from "node:assert/strict";
import test from "node:test";
import {
  activateChildCancellation,
  createRootCancellationLink,
  prepareChildCancellation,
} from "../../../../../src/shell/cancellation.js";

test("successful owned activation consumes preparation with one stable replay error", () => {
  const parent = createRootCancellationLink({
    admission: { depth: 0, maxDepth: 16, resourceLimit: 8 },
  });
  const local = new AbortController();
  const prepared = prepareChildCancellation(
    parent,
    { signal: local.signal },
    { depth: 1, maxDepth: 16, resourceLimit: 2 },
  );
  const boundary = activateChildCancellation(prepared);
  let first: unknown;
  let second: unknown;
  try { activateChildCancellation(prepared); }
  catch (error) { first = error; }
  try { activateChildCancellation(prepared); }
  catch (error) { second = error; }
  assert.ok(first instanceof Error);
  assert.strictEqual(second, first);
  assert.equal(boundary.close().failures.length, 0);
  assert.equal(parent.close().failures.length, 0);
});

