import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { differentialCases, syntaxCases } from "../cases.js";
import { additionalCases } from "../current-gaps/cases.js";
import type { Observation, Snapshot, StressCase } from "../model.js";
import { isolatedSpawn } from "../process.js";
import { nativeCaptureSha256, validateSourceBindings } from "./pin-migration/current-binding.js";

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
export const nativeChildPids: number[] = [];
export const evidence = JSON.parse(readFileSync(join(artifactRoot, "native-baseline.json"), "utf8")) as Evidence;
export const fixtures = [
  ...differentialCases.map(fixture => ({ cohort: "original-differential", fixture })),
  ...syntaxCases.map(fixture => ({ cohort: "original-syntax", fixture })),
  ...additionalCases.map(fixture => ({ cohort: "current-gaps", fixture })),
];
export const profileName = process.env.VIRTUAL_BASH_DIAGNOSTIC_PROFILE ?? "primary-5.3";
const selected = evidence.profiles.find(profile => profile.name === profileName);
assert.ok(selected, `Unknown explicit diagnostic profile: ${profileName}`);
export const profile: Profile = selected;
export const frozen = evidence.captures.find(capture => capture.profile === profileName && capture.argv0 === "shell" && capture.repetition === 1)!;
assert.ok(frozen, `Missing complete capture for ${profileName}`);

export function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function environment(directory: string): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, LANG: "C", LC_ALL: "C", TZ: "UTC" };
}

function snapshot(directory: string, prefix = ""): Snapshot {
  const result: Snapshot = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const key = `${prefix}${entry.name}`;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result[key] = { type: "directory" };
      Object.assign(result, snapshot(path, `${key}/`));
    } else {
      assert.ok(entry.isFile(), `Unexpected native artifact: ${key}`);
      result[key] = { type: "file", base64: readFileSync(path).toString("base64") };
    }
  }
  return result;
}

export function validateFrozenProfile(): void {
  validateProfile("historical");
}

export function validateCurrentProfile(): void {
  validateProfile("current");
}

function validateProfile(binding: "historical" | "current"): void {
  assert.equal(sha256(join(artifactRoot, "native-baseline.json")), nativeCaptureSha256, "Frozen native capture changed");
  assert.equal(sha256(profile.executable), profile.sha256, "Pinned native executable changed or unavailable");
  assert.equal(fixtures.length, 88);
  assert.equal(frozen.rows.length, fixtures.length);
  assert.deepEqual(frozen.rows.map(row => ({ cohort: row.cohort, fixture: row.fixture })), fixtures);
  validateSourceBindings(root, evidence.sources, binding);
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

export async function runNative(fixture: StressCase, reference: Profile = profile, argv0 = "shell"): Promise<Observation> {
  const directory = mkdtempSync(join(artifactRoot, ".native-"));
  try {
    for (const [name, content] of Object.entries(fixture.initialFiles ?? {})) {
      const path = resolve(directory, name);
      assert.ok(path.startsWith(`${directory}/`), `Unsafe native fixture path: ${name}`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    for (const name of Object.keys(fixture.env ?? {})) assert.match(name, /^(?:STRESS_[A-Z_]+|VALUE|EMPTY|PRESENT)$/u);
    const result = await isolatedSpawn(reference.executable, ["--noprofile", "--norc", "-c", fixture.script, argv0], {
      cwd: directory, env: { ...environment(directory), ...fixture.env }, input: fixture.stdin ?? "", timeout: 2000, maxBuffer: 262144,
    });
    if (result.pid !== undefined) nativeChildPids.push(result.pid);
    assert.equal(result.error, undefined, `${fixture.name}: ${result.error?.message}`);
    assert.equal(result.signal, null, fixture.name);
    assert.notEqual(result.status, null, fixture.name);
    return {
      stdout: result.stdout.toString(), stderr: result.stderr.toString(),
      stdoutBase64: result.stdout.toString("base64"), stderrBase64: result.stderr.toString("base64"),
      exitCode: result.status!, files: snapshot(directory),
    };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export async function validateNativeIdentityAndLifecycle(): Promise<void> {
  const directory = mkdtempSync(join(artifactRoot, ".identity-"));
  try {
    const version = await isolatedSpawn(profile.executable, ["--noprofile", "--norc", "--version"], {
      cwd: directory, env: environment(directory), timeout: 2000, maxBuffer: 65536,
    });
    if (version.pid !== undefined) nativeChildPids.push(version.pid);
    assert.equal(version.error, undefined);
    assert.equal(version.status, 0);
    assert.equal(version.stdout.toString(), profile.version);
    assert.equal(version.stderr.length, 0);
    const result = await isolatedSpawn(profile.executable, frozen.lifecycle.args, {
      cwd: directory, env: environment(directory), timeout: 200, maxBuffer: 1024,
    });
    if (result.pid !== undefined) nativeChildPids.push(result.pid);
    assert.equal(result.error?.message, frozen.lifecycle.error);
    assert.equal(result.status, frozen.lifecycle.status);
    assert.equal(result.signal, frozen.lifecycle.signal);
    assert.equal(result.stdout.toString("base64"), frozen.lifecycle.stdoutBase64);
    assert.equal(result.stderr.toString("base64"), frozen.lifecycle.stderrBase64);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
