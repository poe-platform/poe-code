import assert from "node:assert/strict";
import test from "node:test";
import { unsupportedRegexCases } from "./regex-cases.js";
import { run } from "./helpers.js";
import { nullableAuditCases } from "../expr-author/regex-audit-cases.js";

test("documented unsupported native workflows are errors, not native passes", async () => {
  for (const specimen of unsupportedRegexCases()) {
    const actual = await run(specimen.args, {}, { env: { LC_ALL: specimen.locale } });
    assert.equal(actual.exitCode, 2, specimen.name);
    assert.equal(actual.stdout, "");
    assert.match(actual.stderr, /^expr: unsupported BRE:/u);
  }
});

test("nullable repeated-capture backreferences are explicitly unsupported across audit subjects", { timeout: 30_000 }, async () => {
  const specimens = nullableAuditCases().filter(specimen => specimen.args.at(-1) === "\\(a*\\)*\\1");
  assert.equal(specimens.length, 11, "all known-gap audit subjects remain selected");
  for (const specimen of specimens) {
    const observed = await run(specimen.args, {}, { env: { LC_ALL: specimen.locale } });
    const actual = { exitCode: observed.exitCode, stdoutHex: observed.stdoutHex, stderr: observed.stderr };
    assert.equal(actual.exitCode, 2, specimen.name);
    assert.equal(actual.stdoutHex, "", specimen.name);
    assert.equal(actual.stderr, "expr: unsupported BRE: backreference to a capture in nullable repetition\n", specimen.name);
  }
});
