import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

interface Artifact { readonly sha256: string; readonly contents: string }
interface Receipt { readonly path: string; readonly sha256: string }
interface Subject {
  readonly id: number;
  readonly purpose: string;
  readonly source: string;
  readonly sourceSHA256: string;
  readonly sourceBytes: number;
  readonly input: string;
  readonly gates: readonly number[];
}
interface Observation {
  readonly id: number;
  readonly source: string;
  readonly sourceHex: string;
  readonly sourceSHA256: string;
  readonly stdinHex: string;
  readonly stdoutHex: string;
  readonly stderrHex: string;
  readonly subjectStatus: number;
  readonly measuredWaitStatus: number;
  readonly receipts: readonly Receipt[];
}
interface Result extends Omit<Observation, "sourceHex" | "measuredWaitStatus" | "receipts"> {
  readonly status: number;
  readonly signal: null;
  readonly deadlineExceeded: boolean;
  readonly cleanupComplete: boolean;
  readonly childClosed: boolean;
  readonly pendingWrites: number;
  readonly signalAttempts: number;
  readonly closedPipes: readonly number[];
  readonly ownedPipeCount: number;
  readonly accounting: {
    readonly attempted: { readonly stdin: number; readonly owner: number };
    readonly acknowledged: { readonly stdin: number; readonly owner: number };
  };
}
interface Startup {
  readonly entry: Subject;
  readonly argv: readonly string[];
  readonly wrapper: string;
  readonly sourceSHA256: string;
  readonly stdinHex: string;
  readonly environment: { readonly LC_ALL: string; readonly PATH: string };
  readonly admission: Readonly<Record<"bash" | "node" | "subjects" | "supervisor" | "runner" | "outer" | "audit", Pick<Artifact, "sha256">>>;
}

const descriptor = openSync(new URL("./negation53-reference.json", import.meta.url), constants.O_RDONLY | constants.O_NOFOLLOW);
let bytes: Buffer;
try {
  const stat = fstatSync(descriptor);
  assert.ok(stat.isFile() && Number.isSafeInteger(stat.size) && stat.size > 0 && stat.size <= 1048576);
  bytes = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    const count = readSync(descriptor, bytes, offset, remaining, offset);
    assert.ok(Number.isSafeInteger(count) && count > 0 && count <= remaining, "Negation reference ended early or returned an invalid byte count");
    offset += count;
  }
  assert.equal(readSync(descriptor, Buffer.alloc(1), 0, 1, offset), 0, "Negation reference grew during reading");
  const after = fstatSync(descriptor);
  assert.ok(after.isFile());
  for (const key of ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"] as const) assert.equal(after[key], stat[key], "Negation reference identity changed during reading");
} finally { closeSync(descriptor); }

const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
assert.equal(digest(bytes), "2400e2f16c4f71fdca26466512faf6a19dab501f57896ab455268be98e1782aa");
const reference = JSON.parse(bytes.toString()) as {
  readonly format: number;
  readonly classification: string;
  readonly origin: string;
  readonly profile: { readonly platform: string; readonly nodeVersion: string };
  readonly artifacts: Readonly<Record<string, Artifact>>;
};
assert.equal(reference.format, 1);
assert.equal(reference.origin, "/private/tmp/jobs53-negation-YOjRP6");
assert.equal(reference.profile.platform, "darwin");
assert.equal(reference.profile.nodeVersion, "v22.23.2");
assert.ok(reference.classification.includes("NOT the prior reviewer expected goldens [1,0,1,0]"));
assert.equal(Object.keys(reference.artifacts).length, 39);
for (const artifact of Object.values(reference.artifacts)) assert.equal(digest(artifact.contents), artifact.sha256);

function artifact(name: string): Artifact {
  const captured = reference.artifacts[name];
  assert.ok(captured, `Missing immutable negation artifact ${name}`);
  return captured;
}

function decode<Value>(name: string): Value {
  return JSON.parse(artifact(name).contents) as Value;
}

assert.equal(artifact("handoff.json").sha256, "cb7a5a94837dfdaed099383de20f5a4688bbf352e853a32da3aed1075e89fc99");
assert.equal(artifact("subjects.json").sha256, "c477efe994d64a522078f8c16fbd2c30c4ac999e4006175a129152c6cf1ca82f");
assert.equal(artifact("final.json").sha256, "1021d9fe7afbce65a96a92f997598b4230a04509e4e07f95f8492d44632dff58");
assert.equal(artifact("supervisor.bash").sha256, "6a63272112393f50f5a994fea6adfa39950e6e81449acffbf639c880def1b5fb");
const handoff = decode<{
  readonly cases: readonly Observation[];
  readonly measuredWaitStatuses: readonly number[];
  readonly retries: number;
  readonly signals: number;
  readonly outer: { readonly code: number; readonly signal: null; readonly handle: { readonly closed: boolean } };
  readonly admissionCleanup: { readonly handles: readonly { readonly closed: boolean }[] };
}>("handoff.json");
const subjects = decode<{ readonly subjects: readonly Subject[] }>("subjects.json").subjects;
assert.equal(handoff.retries, 0);
assert.equal(handoff.signals, 0);
assert.equal(handoff.outer.code, 0);
assert.equal(handoff.outer.signal, null);
assert.equal(handoff.outer.handle.closed, true);
assert.equal(handoff.admissionCleanup.handles.length, 9);
assert.ok(handoff.admissionCleanup.handles.every(handle => handle.closed));
assert.equal(handoff.cases.length, 4);
assert.equal(subjects.length, 4);
assert.equal(artifact("proposed-subjects.json").contents, artifact("subjects.json").contents);
const records = new Map<number, { readonly name: string; readonly result: Result }>();
for (const subject of subjects) {
  const resultName = `case-${subject.id}-result.json`;
  const startupName = `case-${subject.id}-startup.json`;
  const result = decode<Result>(resultName);
  const startup = decode<Startup>(startupName);
  const observation = handoff.cases.find(entry => entry.id === subject.id);
  assert.ok(observation);
  assert.equal(observation.receipts.find(entry => entry.path === `${reference.origin}/${resultName}`)?.sha256, artifact(resultName).sha256);
  assert.equal(observation.receipts.find(entry => entry.path === `${reference.origin}/${startupName}`)?.sha256, artifact(startupName).sha256);
  assert.equal(result.id, subject.id);
  assert.equal(digest(result.source), subject.sourceSHA256);
  assert.equal(result.sourceSHA256, subject.sourceSHA256);
  assert.equal(result.source, subject.source);
  assert.equal(startup.entry.source, subject.source);
  assert.equal(startup.sourceSHA256, subject.sourceSHA256);
  assert.equal(Buffer.byteLength(result.source), subject.sourceBytes);
  assert.deepEqual(subject.gates, []);
  assert.equal(subject.input, "");
  assert.equal(startup.argv[3], artifact("supervisor.bash").contents);
  assert.equal(startup.argv[5], result.source);
  assert.equal(startup.wrapper, artifact("supervisor.bash").contents);
  for (const [role, name] of [["subjects", "subjects.json"], ["supervisor", "supervisor.bash"], ["runner", "capture.mjs"], ["outer", "outer.mjs"], ["audit", "final.json"]] as const) assert.equal(startup.admission[role].sha256, artifact(name).sha256);
  assert.equal(startup.admission.bash.sha256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
  assert.equal(startup.admission.node.sha256, "18e387c90ab8a8400183e8bdd396376e1e875b91b4c874b894dcade7b35bf572");
  assert.deepEqual(startup.environment, { LC_ALL: "C", PATH: "/__ordinary_jobs_no_external_commands__" });
  assert.equal(startup.stdinHex, result.stdinHex);
  assert.equal(Buffer.from(result.source).toString("hex"), observation.sourceHex);
  for (const field of ["source", "sourceSHA256", "stdinHex", "stdoutHex", "stderrHex", "subjectStatus"] as const) assert.equal(result[field], observation[field]);
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
  assert.deepEqual(result.accounting.attempted, { stdin: 0, owner: 8 });
  assert.deepEqual(result.accounting.acknowledged, result.accounting.attempted);
  assert.equal(records.has(result.id), false);
  records.set(result.id, { name: subject.purpose, result });
}
assert.deepEqual([...records.keys()].sort((first, second) => first - second), [1, 2, 3, 4]);

export function negationJobReference(id: number) {
  const entry = records.get(id);
  assert.ok(entry, `Missing Bash 5.3 negation case ${id}`);
  return {
    name: entry.name, source: entry.result.source, status: entry.result.subjectStatus,
    stdin: Buffer.from(entry.result.stdinHex, "hex"),
    stdout: Buffer.from(entry.result.stdoutHex, "hex"),
    stderr: Buffer.from(entry.result.stderrHex, "hex"),
  };
}
