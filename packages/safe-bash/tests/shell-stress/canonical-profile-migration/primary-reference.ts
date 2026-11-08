import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Observation, Snapshot, StressCase } from "../model.js";

interface FrozenMetadata {
  sourceCommit: string;
  nativeCaptureSha256: string;
  profile: string;
  binarySha256: string;
  invocationName: string;
  sourceFiles: Record<string, string>;
  fixtures: { cohort: string; fixture: StressCase }[];
}

interface NativeRow {
  profile: string;
  invocationName: string;
  cohort: string;
  name: string;
  source: string;
  sourceSha256: string;
  inputHex: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  before: Record<string, { type: "directory" | "file"; mode: number; hex?: string }>;
  after: Record<string, { type: "directory" | "file"; mode: number; hex?: string }>;
  status: number;
  stdoutHex: string;
  stderrHex: string;
  signal: string | null;
  error: string | null;
}

const digest = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const metadataBytes = readFileSync(new URL("./primary-fixtures.json", import.meta.url));
assert.equal(digest(metadataBytes), "76204fc288836d2cde65156ee2d2f610d9ac31466414cc4ef2ec520284d72ec8");
const metadata = JSON.parse(metadataBytes.toString()) as FrozenMetadata;
assert.equal(metadata.sourceCommit, "6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a");
assert.equal(metadata.profile, "GNU5.3-primary");
assert.equal(metadata.invocationName, "shell");
assert.equal(metadata.binarySha256, "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c");
for (const [path, expected] of Object.entries(metadata.sourceFiles)) assert.equal(digest(readFileSync(new URL(`../../../${path}`, import.meta.url))), expected, `Frozen fixture file changed: ${path}`);
const captureBytes = readFileSync(new URL("./native.json", import.meta.url));
assert.equal(metadata.nativeCaptureSha256, "de379916112faa3cec68f3180b5ba55758eda415f2016456d448f635c9871bf5");
assert.equal(digest(captureBytes), metadata.nativeCaptureSha256);
const capture = JSON.parse(captureBytes.toString()) as { profiles: { id: string; sha256: string; version: string }[]; rows: NativeRow[] };
const profile = capture.profiles.find(candidate => candidate.id === metadata.profile);
assert.ok(profile);
assert.equal(profile.sha256, metadata.binarySha256);
const rows = capture.rows.filter(row => row.profile === metadata.profile && row.invocationName === metadata.invocationName);
assert.equal(rows.length, 88);
assert.deepEqual(rows.map(({ cohort, name }) => ({ cohort, name })), metadata.fixtures.map(({ cohort, fixture }) => ({ cohort, name: fixture.name })));

function observation(row: NativeRow): Observation {
  const files: Snapshot = {};
  for (const [path, entry] of Object.entries(row.after)) {
    if (entry.type === "directory") files[path] = { type: "directory" };
    else {
      assert.equal(typeof entry.hex, "string");
      files[path] = { type: "file", base64: Buffer.from(entry.hex!, "hex").toString("base64") };
    }
  }
  const stdout = Buffer.from(row.stdoutHex, "hex");
  const stderr = Buffer.from(row.stderrHex, "hex");
  return { stdout: stdout.toString(), stderr: stderr.toString(), stdoutBase64: stdout.toString("base64"), stderrBase64: stderr.toString("base64"), exitCode: row.status, files };
}

const references = new Map<string, { fixture: StressCase; expected: Observation }>();
for (const [index, row] of rows.entries()) {
  const fixture = metadata.fixtures[index]!.fixture;
  assert.equal(row.source, fixture.script);
  assert.equal(row.sourceSha256, digest(fixture.script));
  assert.equal(row.inputHex, Buffer.from(fixture.stdin ?? "").toString("hex"));
  assert.deepEqual(row.args, ["--noprofile", "--norc", "-c", fixture.script, "shell"]);
  assert.deepEqual(row.env, { PATH: "/usr/bin:/bin", HOME: row.cwd, TMPDIR: row.cwd, LANG: "C", LC_ALL: "C", TZ: "UTC", ...fixture.env });
  assert.deepEqual(Object.fromEntries(Object.entries(row.before).filter(([, entry]) => entry.type === "file").map(([path, entry]) => [path, entry.hex])),
    Object.fromEntries(Object.entries(fixture.initialFiles ?? {}).map(([path, contents]) => [path, Buffer.from(contents).toString("hex")])));
  assert.equal(row.signal, null);
  assert.equal(row.error, null);
  assert.ok(Number.isSafeInteger(row.status));
  assert.equal(references.has(fixture.name), false);
  references.set(fixture.name, { fixture, expected: observation(row) });
}

export async function primaryObservation(fixture: StressCase): Promise<Observation> {
  const reference = references.get(fixture.name);
  assert.ok(reference, `Unfrozen profile case: ${fixture.name}`);
  assert.deepEqual(fixture, reference.fixture, `Frozen case/source/stdin/files/env/limits changed: ${fixture.name}`);
  return structuredClone(reference.expected);
}

export function primaryVersion(): string {
  return `${profile!.version.trim()}\nFrozen GNU5.3-primary ${metadata.binarySha256}; --noprofile --norc -c ORIGINAL_SOURCE shell; no host binary execution`;
}
