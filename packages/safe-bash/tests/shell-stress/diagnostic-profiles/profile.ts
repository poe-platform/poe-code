import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { differentialCases, syntaxCases } from "../cases.js";
import { additionalCases } from "../current-gaps/cases.js";
import type { Observation, StressCase } from "../model.js";
import { nativeCaptureSha256 } from "./pin-migration/current-binding.js";

export interface Profile {
  name: string;
  executable: string;
  sha256: string;
  version: string;
}

interface NativeRow {
  cohort: string;
  fixture: StressCase;
  args: string[];
  environment: NodeJS.ProcessEnv;
  pid: number;
  observation: Observation;
}

interface NativeCapture {
  argv0: string;
  profile: string;
  repetition: number;
  rows: NativeRow[];
  lifecycle: {
    name: string;
    args: string[];
    environment: NodeJS.ProcessEnv;
    pid: number;
    status: number | null;
    signal: NodeJS.Signals | null;
    error: string;
    stdoutBase64: string;
    stderrBase64: string;
  };
}

interface Evidence {
  profiles: Profile[];
  sources: Record<string, string>;
  captures: NativeCapture[];
}

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export const artifactRoot = join(root, "benchmarks/shell-stress/diagnostic-profiles");
export const evidence = JSON.parse(readFileSync(join(artifactRoot, "native-baseline.json"), "utf8")) as Evidence;
export const fixtures = [
  ...differentialCases.map(fixture => ({ cohort: "original-differential", fixture })),
  ...syntaxCases.map(fixture => ({ cohort: "original-syntax", fixture })),
  ...additionalCases.map(fixture => ({ cohort: "current-gaps", fixture })),
];
export const profileName = "primary-5.3";
const selected = evidence.profiles.find(profile => profile.name === profileName);
assert.ok(selected, `Unknown explicit diagnostic profile: ${profileName}`);
export const profile: Profile = selected;
export const frozen = evidence.captures.find(capture => capture.profile === profileName && capture.argv0 === "shell" && capture.repetition === 1)!;
assert.ok(frozen, `Missing complete capture for ${profileName}`);

export function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function validateFrozenProfile(): void {
  assert.equal(sha256(join(artifactRoot, "native-baseline.json")), nativeCaptureSha256, "Frozen native capture changed");
  assert.equal(fixtures.length, 88);
  assert.equal(frozen.rows.length, fixtures.length);
  assert.deepEqual(frozen.rows.map(row => ({ cohort: row.cohort, fixture: row.fixture })), fixtures);
  for (const candidate of evidence.profiles) {
    for (const argv0 of ["shell-stress", "shell"]) {
      const captures = evidence.captures.filter(capture => capture.profile === candidate.name && capture.argv0 === argv0);
      assert.deepEqual(captures.map(capture => capture.repetition), [1, 2]);
      for (const capture of captures) {
        assert.deepEqual(capture.rows.map(row => ({ cohort: row.cohort, fixture: row.fixture })), fixtures);
        for (const row of capture.rows) {
          assert.deepEqual(row.args, ["--noprofile", "--norc", "-c", row.fixture.script, argv0]);
          assert.equal(Buffer.from(row.observation.stdoutBase64, "base64").toString(), row.observation.stdout);
          assert.equal(Buffer.from(row.observation.stderrBase64, "base64").toString(), row.observation.stderr);
        }
      }
      assert.deepEqual(captures[0]!.rows.map(row => row.observation), captures[1]!.rows.map(row => row.observation));
    }
  }
}
