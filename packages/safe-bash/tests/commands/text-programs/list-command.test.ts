import assert from "node:assert/strict";
import test from "node:test";
import { compareNative, runVirtual } from "./helpers.js";

for (const stdin of ["a\tb\n", "no final newline", "", "a".repeat(58) + "\tZ\n", "a".repeat(130) + "\n", Buffer.from([0, 7, 8, 9, 10, 11, 12, 13, 27, 127, 128, 255, 10])]) {
  test(`sed l native control/width fixture ${Buffer.from(stdin).toString("base64")}`, async () => {
    await compareNative("sed", { args: ["-n", "l"], stdin });
  });
}

test("sed l escapes backslashes unambiguously rather than copying BSD's ambiguous literal", async () => {
  const actual = await runVirtual("sed", { args: ["-n", "l"], stdin: "\\t\n" });
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.stdout.toString(), "\\\\t$\n");
});

test("sed l addresses and multiline pattern-space escapes", async () => {
  await compareNative("sed", { args: ["-n", "1{N;l;}"], stdin: "a\nb\nc\n" });
});
