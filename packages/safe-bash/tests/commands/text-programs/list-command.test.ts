import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./helpers.js";

test("sed l escapes backslashes unambiguously rather than copying BSD's ambiguous literal", async () => {
  const actual = await runVirtual("sed", { args: ["-n", "l"], stdin: "\\t\n" });
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.stdout.toString(), "\\\\t$\n");
});
