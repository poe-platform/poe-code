import assert from "node:assert/strict";
import test from "node:test";
import { compare, totals, type Execution } from "./model.js";
import type { TextCase } from "./cases.js";

const fixture: TextCase = { name: "harness", tool: "awk", feature: "harness", args: [] };
const completed = (exitCode: number, stderr = ""): Execution => ({ status: "completed", durationMs: 1,
  observation: { exitCode, stdout: "", stderr: Buffer.from(stderr).toString("base64"), files: {} } });

test("an unexpected native error is not a compatibility pass even when outputs agree", () => {
  assert.equal(compare(fixture, completed(2), completed(2)).status, "oracle-rejected");
  assert.equal(compare({ ...fixture, nativeExitCode: 7 }, completed(7), completed(7)).status, "pass");
});

test("undelivered commands and explicit unsupported syntax remain non-successes", () => {
  const pending = compare(fixture, completed(0), { status: "pending", reason: "not delivered", durationMs: 0 });
  const unsupported = compare(fixture, completed(0), completed(2, "unsupported command"));
  assert.equal(pending.status, "pending");
  assert.equal(unsupported.status, "unsupported");
  assert.deepEqual(totals([pending, unsupported]), { total: 2, pass: 0, fail: 0, unsupported: 1, pending: 1, error: 0, timeout: 0, "oracle-unavailable": 0, "oracle-rejected": 0, skipped: 0 });
});

test("native byte and permission differences are not normalized away", () => {
  const expected = completed(0);
  const actual = completed(0);
  assert.equal(expected.status, "completed");
  assert.equal(actual.status, "completed");
  if (expected.status !== "completed" || actual.status !== "completed") throw new Error("Invalid fixture");
  expected.observation.stdout = Buffer.from([255]).toString("base64");
  actual.observation.stdout = Buffer.from("�").toString("base64");
  expected.observation.files.file = { type: "file", bytes: "", mode: 0o644 };
  actual.observation.files.file = { type: "file", bytes: "", mode: 0o666 };
  assert.deepEqual(compare(fixture, expected, actual).differences, ["stdout", "file:file"]);
});
