import assert from "node:assert/strict";
import test from "node:test";
import { contents, run } from "./helpers.test.js";

test("patch rejects plain text from stdin", async () => {
  const result = await run("patch", ["-p0"], { input: "hello\nworld\n" });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "patch: **** Only garbage was found in the patch input.\n");
});

test("patch rejects plain text from -i without changing the input", async () => {
  const result = await run("patch", ["-p0", "-i", "p"], { files: { p: "random text\n" } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "patch: **** Only garbage was found in the patch input.\n");
  assert.equal(await contents(result.fs, "p"), "random text\n");
});
