import assert from "node:assert/strict";
import test from "node:test";
import { regexCases, unsupportedRegexCases } from "./regex-cases.js";
import { native, qualifyOracle } from "./oracle.js";
import { run } from "./helpers.js";
import { nullableAuditCases } from "../expr-author/regex-audit-cases.js";

test("author BRE controls: exact GNU9.7 Darwin status/stdout/stderr", { timeout: 30_000 }, async () => {
  qualifyOracle();
  const mismatches = [];
  for (const specimen of regexCases()) {
    const expected = native(specimen.args, specimen.locale);
    const observed = await run(specimen.args, {}, { env: { LC_ALL: specimen.locale } });
    const actual = { exitCode: observed.exitCode, stdoutHex: observed.stdoutHex, stderr: observed.stderr };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push({ ...specimen, expected, actual });
  }
  assert.deepEqual(mismatches, []);
});

test("documented unsupported native workflows are errors, not native passes", async () => {
  qualifyOracle();
  for (const specimen of unsupportedRegexCases()) {
    const expected = native(specimen.args, specimen.locale);
    assert.ok(expected.exitCode < 2, specimen.name);
    const actual = await run(specimen.args, {}, { env: { LC_ALL: specimen.locale } });
    assert.equal(actual.exitCode, 2, specimen.name);
    assert.equal(actual.stdout, "");
    assert.match(actual.stderr, /^expr: unsupported BRE:/u);
  }
});

test("nullable author audit preserves all controls and explicitly classifies the known gap", { timeout: 30_000 }, async () => {
  qualifyOracle();
  const mismatches = [];
  let unsupported = 0;
  for (const specimen of nullableAuditCases()) {
    const expected = native(specimen.args, specimen.locale);
    const observed = await run(specimen.args, {}, { env: { LC_ALL: specimen.locale } });
    const actual = { exitCode: observed.exitCode, stdoutHex: observed.stdoutHex, stderr: observed.stderr };
    if (specimen.args.at(-1) === "\\(a*\\)*\\1") {
      unsupported++;
      assert.equal(actual.exitCode, 2);
      assert.equal(actual.stdoutHex, "");
      assert.equal(actual.stderr, "expr: unsupported BRE: backreference to a capture in nullable repetition\n");
      assert.ok(expected.exitCode < 2);
    } else if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push({ ...specimen, expected, actual });
  }
  assert.equal(unsupported, 11, "unsupported cases remain in original denominator, never counted as native passes");
  assert.deepEqual(mismatches, []);
});
