import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface ControlWrite {
  readonly fd: number;
  readonly method: "write" | "end";
  readonly hex: string;
}

interface ReferenceRecord {
  readonly fixture: string;
  readonly args: readonly string[];
  readonly inputHex: string | null;
  readonly writes: readonly ControlWrite[];
  readonly status: number;
  readonly stdoutHex: string;
  readonly stderrHex: string;
  readonly release?: {
    readonly markerHex: string;
    readonly minimumHoldMs: number;
    readonly events: readonly { readonly kind: string; readonly at: number; readonly hex?: string }[];
  };
}

interface Reference {
  readonly oracle: { readonly name: string; readonly executableSHA256: string; readonly locale: string };
  readonly historySHA256: string;
  readonly historicalFixtures: readonly { readonly file: string; readonly sha256: string }[];
  readonly records: readonly ReferenceRecord[];
}

const data = readFileSync(new URL("./primary-reference.json", import.meta.url));
assert.equal(createHash("sha256").update(data).digest("hex"), "b8fdff9ae056741dc9a57890959bb4c0196b87718eef6c1f6e3e9c0057f0b864");
const reference = JSON.parse(data.toString()) as Reference;
assert.equal(reference.oracle.name, "5.3.0");
assert.equal(reference.oracle.executableSHA256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
assert.equal(reference.oracle.locale, "C");
const history = readFileSync(new URL("./historical-5.2-reference.json", import.meta.url));
assert.equal(createHash("sha256").update(history).digest("hex"), reference.historySHA256);
const archive = JSON.parse(history.toString()) as { fixtures: readonly { file: string; sha256: string; source: string }[] };
assert.equal(archive.fixtures.length, 12);
for (const fixture of archive.fixtures) {
  assert.equal(createHash("sha256").update(fixture.source).digest("hex"), fixture.sha256);
  assert.equal(reference.historicalFixtures.find(entry => entry.file === fixture.file)?.sha256, fixture.sha256);
}

export function primaryReference(fixture: string, script: string, input?: string | Uint8Array, writes: readonly ControlWrite[] = []) {
  const args = ["--noprofile", "--norc", "-c", script, "shell"];
  const inputHex = input === undefined ? null : Buffer.from(input).toString("hex");
  const candidates = reference.records.filter(entry => entry.fixture === fixture && entry.inputHex === inputHex
    && JSON.stringify(entry.args) === JSON.stringify(args) && JSON.stringify(entry.writes) === JSON.stringify(writes));
  assert.ok(candidates.length, `Missing exact primary Bash 5.3 capture for ${fixture}: ${script}`);
  const selected = candidates[0]!;
  for (const candidate of candidates) assert.deepEqual(candidate, selected, "Duplicate captures must agree exactly");
  assert.ok(Number.isInteger(selected.status) && selected.status >= 0 && selected.status <= 255);
  for (const hex of [selected.stdoutHex, selected.stderrHex]) {
    assert.ok(hex.length <= 131072 && hex.length % 2 === 0);
    assert.ok([...hex].every(character => "0123456789abcdef".includes(character)));
  }
  return { status: selected.status, signal: null, stdout: Buffer.from(selected.stdoutHex, "hex"), stderr: Buffer.from(selected.stderrHex, "hex"), release: selected.release };
}
