import assert from "node:assert/strict";
import test from "node:test";
import { nativeCases } from "./native-cases.js";
import { qualifyOracle, native } from "./oracle.js";
import { run } from "./helpers.js";

test("pinned GNU 9.7 author cohort compares exact status/stdout/stderr", async () => {
  qualifyOracle();
  for (const specimen of nativeCases()) {
    const expected = native(specimen.args, specimen.locale);
    const actual = await run(specimen.args, {}, { env: { LC_ALL: specimen.locale } });
    assert.deepEqual({ exitCode: actual.exitCode, stdoutHex: actual.stdoutHex, stderr: actual.stderr }, expected, specimen.name);
  }
});
