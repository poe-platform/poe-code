import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./helpers.js";

test("invalid pattern references fail before in-place effects", async () => {
  for (const program of ["s/\\1/x/", "s/\\(a\\1\\)/x/"]) {
    const actual = await runVirtual("sed", { args: ["-i.bak", program, "input"], files: { input: "keep\n" } });
    assert.notEqual(actual.exitCode, 0);
    assert.deepEqual(actual.files, { input: Buffer.from("keep\n") });
  }
});

test("capture and backreference expansion remains execution-budget bounded", async () => {
  const actual = await runVirtual("sed", { args: ["s/\\(a*\\)*\\1$/X/"], stdin: "a".repeat(200) + "!\n" }, { maxSteps: 1000 });
  assert.notEqual(actual.exitCode, 0);
  assert.match(actual.stderr.toString(), /limit exceeded/u);
});
