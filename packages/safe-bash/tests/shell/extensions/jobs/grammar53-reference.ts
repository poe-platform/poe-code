import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

interface Captured { readonly sha256: string; readonly text: string }
interface Subject { readonly id: number; readonly purpose: string; readonly source: string; readonly sourceSHA256: string }
interface Observation {
  readonly id: number;
  readonly source: string;
  readonly sourceSHA256: string;
  readonly sourceHex: string;
  readonly stdinHex: string;
  readonly stdoutHex: string;
  readonly stderrHex: string;
  readonly subjectStatus: number;
  readonly receipt: { readonly sha256: string };
}
interface Startup {
  readonly entry: Subject;
  readonly argv: readonly string[];
  readonly wrapper: string;
  readonly sourceSHA256: string;
  readonly stdinHex: string;
  readonly environment: { readonly LC_ALL: string; readonly PATH: string };
  readonly admission: { readonly bash: Pick<Captured, "sha256">; readonly subjects: Pick<Captured, "sha256">; readonly supervisor: Pick<Captured, "sha256"> };
}
interface Result extends Omit<Observation, "sourceHex" | "receipt"> {
  readonly status: number;
  readonly signal: null;
  readonly deadlineExceeded: boolean;
  readonly cleanupComplete: boolean;
  readonly childClosed: boolean;
  readonly pendingWrites: number;
  readonly signalAttempts: number;
  readonly closedPipes: readonly number[];
  readonly ownedPipeCount: number;
}

const descriptor = openSync(new URL("./grammar53-reference.json", import.meta.url), constants.O_RDONLY | constants.O_NOFOLLOW);
let bytes: Buffer;
try {
  const stat = fstatSync(descriptor);
  assert.ok(stat.isFile() && Number.isSafeInteger(stat.size) && stat.size > 0 && stat.size <= 1048576);
  bytes = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    assert.ok(count > 0, "Wait grammar reference ended early");
    offset += count;
  }
  assert.equal(readSync(descriptor, Buffer.alloc(1), 0, 1, offset), 0, "Wait grammar reference grew during reading");
} finally { closeSync(descriptor); }

const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
assert.equal(digest(bytes), "361b7862bdee3f07652f4ff88f9c0696bb7cb94e48246c4607aa0953296c50a0");
const reference = JSON.parse(bytes.toString()) as {
  readonly handoff: Captured;
  readonly subjects: Captured;
  readonly supervisor: Captured;
  readonly records: readonly { readonly startup: Captured; readonly result: Captured }[];
};
function decode<Value>(captured: Captured): Value {
  assert.equal(digest(captured.text), captured.sha256);
  return JSON.parse(captured.text) as Value;
}
assert.equal(reference.handoff.sha256, "799b1f2cc23192a55efa584dd84b711a63257219d4b4ea418e60496d9f1905df");
assert.equal(reference.subjects.sha256, "caf007d923f57945e7028c2dba10f1cbc9dca1e8af2249a1966a398b9f32f971");
assert.equal(digest(reference.supervisor.text), "6a63272112393f50f5a994fea6adfa39950e6e81449acffbf639c880def1b5fb");
const handoff = decode<{
  readonly cases: readonly Observation[];
  readonly retries: number;
  readonly signals: number;
  readonly outer: { readonly handle: { readonly closed: boolean } };
  readonly admissionCleanup: { readonly handles: readonly { readonly closed: boolean }[] };
}>(reference.handoff);
const subjects = decode<{ readonly subjects: readonly Subject[] }>(reference.subjects).subjects;
assert.equal(handoff.retries, 0);
assert.equal(handoff.signals, 0);
assert.equal(handoff.outer.handle.closed, true);
assert.ok(handoff.admissionCleanup.handles.every(handle => handle.closed));
assert.equal(handoff.cases.length, 8);
assert.equal(subjects.length, 8);
assert.equal(reference.records.length, 8);
const records = new Map<number, { readonly name: string; readonly result: Result }>();
for (const captured of reference.records) {
  const result = decode<Result>(captured.result);
  const startup = decode<Startup>(captured.startup);
  const observation = handoff.cases.find(entry => entry.id === result.id);
  const subject = subjects.find(entry => entry.id === result.id);
  assert.ok(observation && subject);
  assert.equal(observation.receipt.sha256, captured.result.sha256);
  assert.equal(digest(result.source), subject.sourceSHA256);
  assert.equal(result.sourceSHA256, subject.sourceSHA256);
  assert.equal(result.source, subject.source);
  assert.equal(startup.entry.source, subject.source);
  assert.equal(startup.sourceSHA256, subject.sourceSHA256);
  assert.equal(startup.argv[3], reference.supervisor.text);
  assert.equal(startup.argv[5], result.source);
  assert.equal(startup.wrapper, reference.supervisor.text);
  assert.equal(startup.admission.supervisor.sha256, reference.supervisor.sha256);
  assert.equal(startup.admission.subjects.sha256, reference.subjects.sha256);
  assert.equal(startup.admission.bash.sha256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
  assert.deepEqual(startup.environment, { LC_ALL: "C", PATH: "/__ordinary_jobs_no_external_commands__" });
  assert.equal(startup.stdinHex, result.stdinHex);
  assert.equal(Buffer.from(observation.sourceHex, "hex").toString(), result.source);
  for (const field of ["stdinHex", "stdoutHex", "stderrHex", "subjectStatus"] as const) assert.equal(result[field], observation[field]);
  for (const hex of [result.stdinHex, result.stdoutHex, result.stderrHex]) {
    assert.ok(hex.length <= 131072 && hex.length % 2 === 0);
    assert.ok([...hex].every(character => "0123456789abcdef".includes(character)));
  }
  assert.equal(result.status, result.subjectStatus);
  assert.equal(result.subjectStatus, 0);
  assert.equal(result.signal, null);
  assert.equal(result.deadlineExceeded, false);
  assert.equal(result.cleanupComplete, true);
  assert.equal(result.childClosed, true);
  assert.equal(result.pendingWrites, 0);
  assert.equal(result.signalAttempts, 0);
  assert.equal(result.ownedPipeCount, 10);
  assert.deepEqual([...result.closedPipes].sort((first, second) => first - second), Array.from({ length: 10 }, (_, index) => index));
  assert.equal(records.has(result.id), false);
  records.set(result.id, { name: subject.purpose, result });
}
assert.deepEqual([...records.keys()].sort((first, second) => first - second), Array.from({ length: 8 }, (_, index) => index + 1));

export function grammarJobReference(id: number) {
  const entry = records.get(id);
  assert.ok(entry, `Missing Bash 5.3 wait grammar case ${id}`);
  return {
    name: entry.name, source: entry.result.source, status: entry.result.subjectStatus,
    stdin: Buffer.from(entry.result.stdinHex, "hex"),
    stdout: Buffer.from(entry.result.stdoutHex, "hex"),
    stderr: Buffer.from(entry.result.stderrHex, "hex"),
  };
}
