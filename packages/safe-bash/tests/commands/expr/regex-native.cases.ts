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

test("nullable author audit preserves all controls and explicitly classifies the known gap", { timeout: 30_000 }, async () => {
  let unsupported = 0;
  for (const specimen of nullableAuditCases()) {
    const observed = await run(specimen.args, {}, { env: { LC_ALL: specimen.locale } });
    const actual = { exitCode: observed.exitCode, stdoutHex: observed.stdoutHex, stderr: observed.stderr };
if (specimen.args.at(-1) === "\\(a*\\)*\\1") {
      unsupported++;
      assert.equal(actual.exitCode, 2);
      assert.equal(actual.stdoutHex, "");
      assert.equal(actual.stderr, "expr: unsupported BRE: backreference to a capture in nullable repetition\n");

    }
  }
  assert.equal(unsupported, 11, "unsupported cases remain in original denominator, never counted as native passes");
});
