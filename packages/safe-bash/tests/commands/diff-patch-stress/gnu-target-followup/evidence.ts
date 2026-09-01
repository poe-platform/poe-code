import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sha256, virtualProbe, type Probe, type NamespaceEntry } from "./helpers.js";

const bytes = readFileSync(new URL("./native-2026-08-26.json", import.meta.url));
export const evidenceSha256 = sha256(bytes);
assert.equal(evidenceSha256, "f8c0a24126d16e72bcf520cd85914c466454c76472d8fded634fbb4ab1bc1f07", "native evidence is immutable; review a new capture instead");
const evidence = JSON.parse(bytes.toString()) as { records: { probe: Probe; inputSha256: string; native: { exitCode: number; stdout: string; stderr: string; before: NamespaceEntry[]; after: NamespaceEntry[] } }[] };
const overlapBytes = readFileSync(new URL("./native-overlap-default-2026-08-26.json", import.meta.url));
export const overlapEvidenceSha256 = sha256(overlapBytes);
assert.equal(overlapEvidenceSha256, "d278925c7c6311baad23c740f8170588d42627de680ca35379cb94450c6e97c4", "default overlap evidence is immutable");
const overlapEvidence = JSON.parse(overlapBytes.toString()) as typeof evidence;

export function captured(probe: Probe) {
  const record = [...evidence.records, ...overlapEvidence.records].find(item => item.probe.id === probe.id);
  assert(record, `missing independent evidence: ${probe.id}`);
  assert.deepEqual(probe, record.probe, "argv, input and initial namespace must match pinned evidence");
  assert.equal(sha256(probe.input), record.inputSha256);
  return record.native;
}

export async function assertDefaultParity(probe: Probe): Promise<void> {
  const expected = captured(probe);
  const actual = await virtualProbe(probe);
  assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, before: actual.before, after: actual.after }, expected,
    `GNU default publication/status/full-namespace parity: ${probe.id}`);
}
