import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { bounded, directory, text } from "./harness.js";

test("isolated matched-delivery, whole-write and backpressure regressions", () => {
  const result = bounded(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", "--experimental-test-isolation=none", join(directory, "streaming-cases.ts")], "", directory, 120000);
  assert.equal(result.code, 0, text(result.stdout) + text(result.stderr));
  assert.match(text(result.stdout), /# pass 6\b/u);
  if (process.env.HARNESS_TIMING === "1") console.log(text(result.stdout));
});
