import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Observation, StressCase } from "../model.js";
import { holdoutCases } from "./cases.js";
import type { HoldoutCase } from "./cases.js";

export interface FrozenReference {
  fixture: HoldoutCase;
  primary: Observation;
  legacy: Observation;
  differs: boolean;
}

export const references = JSON.parse(readFileSync(new URL("../../../benchmarks/shell-stress/targeted-holdout/references.json", import.meta.url), "utf8")) as {
  caseSourceSha256: string;
  primary: { executable: string; sha256: string; stdout: string };
  legacy: { executable: string; sha256: string; stdout: string };
  cases: FrozenReference[];
};

export function validateReferences(): void {
  assert.equal(references.caseSourceSha256, createHash("sha256").update(readFileSync(new URL("./cases.ts", import.meta.url))).digest("hex"), "Case source changed; recapture both versions explicitly, never silently update expectations");
  assert.deepEqual(references.cases.map(row => row.fixture), holdoutCases);
  assert.equal(new Set(holdoutCases.map(fixture => fixture.name)).size, holdoutCases.length);
  for (const row of references.cases) {
    for (const observation of [row.primary, row.legacy]) {
      assert.equal(Buffer.from(observation.stdoutBase64, "base64").toString(), observation.stdout);
      assert.equal(Buffer.from(observation.stderrBase64, "base64").toString(), observation.stderr);
      assert.ok(Number.isInteger(observation.exitCode));
    }
  }
  const sample = references.cases[0]!.primary;
  for (const executable of ["shell-stress", "bash", "shell"]) {
    const stderr = `${executable}: line 7: payload shell: bash: shell-stress:\nunchanged diagnostic line\n`;
    const actual = comparable({ ...sample, stderr, stderrBase64: Buffer.from(stderr).toString("base64") });
    const expectedStderr = "<shell>: line 7: payload shell: bash: shell-stress:\nunchanged diagnostic line\n";
    assert.deepEqual(actual, { ...sample, stderr: expectedStderr, stderrBase64: Buffer.from(expectedStderr).toString("base64") });
  }
}

export function comparable(observation: Observation): Observation {
  const stderrBytes = Buffer.from(observation.stderrBase64, "base64");
  const stderr = stderrBytes.toString().replace(/^(?:shell-stress|bash|shell):/gmu, "<shell>:");
  assert.equal(stderrBytes.toString("base64"), Buffer.from(stderrBytes.toString()).toString("base64"), "Diagnostic normalization must not corrupt non-UTF8 bytes");
  return { ...observation, stderr, stderrBase64: Buffer.from(stderr).toString("base64") };
}

export function virtualFixture(fixture: HoldoutCase): StressCase {
  const locale = fixture.locale ?? "C";
  return { ...fixture, env: { LANG: locale, LC_ALL: locale } };
}
