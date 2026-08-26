import assert from "node:assert/strict";
import test from "node:test";
import { compareNative, runVirtual } from "./helpers.js";

test("portable numeric substitution and standalone label comments have valid native fixtures", async () => {
  await compareNative("sed", { args: ["-E", "s/x*/X/2"], stdin: "abc\n" });
  await compareNative("sed", { args: [":again\n# comment\ns/aa/a/\nt again"], stdin: "aaaa\n" });
});

test("numeric-plus-global extension retains explicit coverage without a rejecting BSD oracle", async () => {
  const actual = await runVirtual("sed", { args: ["-E", "s/x*/X/2g"], stdin: "abc\n" });
  assert.equal(actual.exitCode, 0, actual.stderr.toString());
  assert.equal(actual.stdout.toString(), "aXbXcX\n");
});
