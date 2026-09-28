import assert from "node:assert/strict";
import test from "node:test";
import { settings } from "safe-bash-command-shuf/options";

test("accepts omitted shuf options with unlimited defaults", () => {
  assert.deepEqual(settings(), { maxInputBytes: Infinity, maxSampleSize: Infinity });
  assert.deepEqual(settings({ maxInputBytes: 16, maxSampleSize: 2 }), { maxInputBytes: 16, maxSampleSize: 2 });
});
