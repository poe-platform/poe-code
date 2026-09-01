import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./helpers.js";

test("numeric-plus-global extension retains explicit coverage without a rejecting BSD oracle", async () => {
  const actual = await runVirtual("sed", { args: ["-E", "s/x*/X/2g"], stdin: "abc\n" });
  assert.equal(actual.exitCode, 0, actual.stderr.toString());
  assert.equal(actual.stdout.toString(), "aXbXcX\n");
});
