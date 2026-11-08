import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

interface CapturedBytes { readonly sha256: string; readonly text: string }
interface Subject {
  readonly id: number;
  readonly name: string;
  readonly source: string;
  readonly gates?: readonly number[];
}
interface Startup {
  readonly entry: Subject;
  readonly stdinHex: string;
  readonly admission: { readonly bash: { readonly sha256: string } };
}
interface Result {
  readonly id: number;
  readonly source: string;
  readonly status: number;
  readonly subjectStatus: number;
  readonly signal: null;
  readonly stdoutHex: string;
  readonly stderrHex: string;
  readonly cleanupComplete: boolean;
  readonly identities: Readonly<Record<string, number>>;
}
interface Reference {
  readonly executableSHA256: string;
  readonly checkpoint: CapturedBytes;
  readonly subjects: CapturedBytes;
  readonly records: readonly { readonly startup: CapturedBytes; readonly result: CapturedBytes }[];
}

const descriptor = openSync(new URL("./primary53-reference.json", import.meta.url), constants.O_RDONLY | constants.O_NOFOLLOW);
let bytes: Buffer;
try {
  const stat = fstatSync(descriptor);
  assert.ok(stat.isFile() && stat.size <= 1048576);
  bytes = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    assert.ok(count > 0, "Primary jobs reference ended early");
    offset += count;
  }
  assert.equal(readSync(descriptor, Buffer.alloc(1), 0, 1, offset), 0, "Primary jobs reference grew during reading");
} finally { closeSync(descriptor); }

const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
assert.equal(digest(bytes), "2f03c8498f666a2c0dceb11f7907bc15aea4c21e301b36bd1492da8f20408612");
const reference = JSON.parse(bytes.toString()) as Reference;
assert.equal(reference.executableSHA256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
assert.equal(digest(reference.checkpoint.text), reference.checkpoint.sha256);
assert.equal(digest(reference.subjects.text), reference.subjects.sha256);
const checkpoint = JSON.parse(reference.checkpoint.text) as { completed: number; retries: number; cleanupFailures: number; activeOwnedChildHandles: number; records: readonly { id: number; resultSHA256: string }[] };
assert.equal(checkpoint.completed, 18);
assert.equal(checkpoint.retries, 0);
assert.equal(checkpoint.cleanupFailures, 0);
assert.equal(checkpoint.activeOwnedChildHandles, 0);
const subjects = JSON.parse(reference.subjects.text) as readonly Subject[];
assert.equal(subjects.length, 18);
assert.equal(reference.records.length, 18);
const records = new Map<number, { startup: Startup; result: Result }>();
for (const entry of reference.records) {
  assert.equal(digest(entry.startup.text), entry.startup.sha256);
  assert.equal(digest(entry.result.text), entry.result.sha256);
  const startup = JSON.parse(entry.startup.text) as Startup;
  const result = JSON.parse(entry.result.text) as Result;
  assert.deepEqual(startup.entry, subjects.find(subject => subject.id === result.id));
  assert.equal(startup.admission.bash.sha256, reference.executableSHA256);
  assert.equal(result.source, startup.entry.source);
  assert.equal(result.status, result.subjectStatus);
  assert.equal(result.signal, null);
  assert.equal(result.cleanupComplete, true);
  assert.ok(Number.isInteger(result.subjectStatus) && result.subjectStatus >= 0 && result.subjectStatus <= 255);
  assert.equal(checkpoint.records.find(record => record.id === result.id)?.resultSHA256, entry.result.sha256);
  for (const hex of [startup.stdinHex, result.stdoutHex, result.stderrHex]) {
    assert.ok(hex.length <= 131072 && hex.length % 2 === 0);
    assert.ok([...hex].every(character => "0123456789abcdef".includes(character)));
  }
  assert.equal(records.has(result.id), false);
  records.set(result.id, { startup, result });
}
assert.deepEqual([...records.keys()].sort((left, right) => left - right), Array.from({ length: 18 }, (_, index) => index + 1));

export function primaryJobReference(id: number) {
  const entry = records.get(id);
  assert.ok(entry, `Missing primary Bash 5.3 jobs case ${id}`);
  return {
    name: entry.startup.entry.name,
    source: entry.result.source,
    stdin: Buffer.from(entry.startup.stdinHex, "hex"),
    stdout: Buffer.from(entry.result.stdoutHex, "hex"),
    stderr: Buffer.from(entry.result.stderrHex, "hex"),
    status: entry.result.subjectStatus,
    requiresController: Boolean(entry.startup.entry.gates?.length || Object.keys(entry.result.identities).length),
  };
}
