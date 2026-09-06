import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";

interface Receipt { readonly path: string; readonly sha256: string }
interface Artifact extends Receipt { readonly bytes: number; readonly contents: string }
interface Qualification {
  readonly kind: "observation";
  readonly deterministicGolden: false;
  readonly productReplay: false;
  readonly internalStateTrace: false;
  readonly note: string;
}
interface Profile {
  readonly platform: string;
  readonly release: string;
  readonly version: string;
  readonly arch: string;
  readonly nodeVersion: string;
}
interface Subject {
  readonly id: number;
  readonly proposalId: string;
  readonly source: string;
  readonly sourceSHA256: string;
  readonly sourceHex: string;
  readonly input: string;
  readonly gates: readonly unknown[];
}
interface Invocation { readonly executable: string; readonly argv: readonly string[]; readonly argv0: string; readonly sourceHex: string; readonly sourceLineCount: number }
interface Startup {
  readonly entry: Subject;
  readonly sourceSHA256: string;
  readonly stdinHex: string;
  readonly wrapper: string;
  readonly wrapperSHA256: string;
  readonly subjectInvocation: Invocation;
  readonly environment: Readonly<Record<string, string>>;
  readonly admission: Readonly<Record<string, Receipt>>;
}
interface Result {
  readonly id: number;
  readonly name: string;
  readonly source: string;
  readonly sourceSHA256: string;
  readonly stdinHex: string;
  readonly stdoutHex: string;
  readonly stderrHex: string;
  readonly controlHex: string;
  readonly sourceControlHex: string;
  readonly subjectStatus: number;
  readonly status: number;
  readonly signal: null;
  readonly failure?: unknown;
  readonly deadlineExceeded: boolean;
  readonly cleanupComplete: boolean;
  readonly childClosed: boolean;
  readonly startupConfirmed: boolean;
  readonly localHandlesClosed: boolean;
  readonly pendingWrites: number;
  readonly signalAttempts: number;
  readonly ownedPipeCount: number;
  readonly closedPipes: readonly number[];
  readonly ownerReleaseState: string;
  readonly gatesSent: readonly number[];
  readonly accounting: {
    readonly attempted: Readonly<Record<"stdin" | "start" | "gate" | "owner", number>>;
    readonly acknowledged: Readonly<Record<"stdin" | "start" | "gate" | "owner", number>>;
    readonly combinedActualReceivedAndAttempted: number;
  };
}
interface Seal {
  readonly executionApproved: boolean;
  readonly bindings: Readonly<Record<string, Receipt>>;
  readonly subjects: readonly { readonly sourceSHA256: string; readonly sourceHex: string; readonly stdinHex: string; readonly subjectArgv: readonly string[] }[];
  readonly rootApproval: { readonly independentReview: Receipt; readonly heldInputAdmission: Receipt; readonly checkpointSHA256: string };
}
interface Verification {
  readonly inputs: readonly (Receipt & { readonly bytes: number })[];
  readonly observations: readonly { readonly id: number; readonly sourceSHA256: string; readonly stdoutHex: string; readonly stderrHex: string; readonly subjectStatus: number }[];
  readonly subjectsCompleted: number;
  readonly supervisorsCompleted: number;
  readonly closedPipes: number;
  readonly outerAdmissionHandlesClosed: number;
  readonly outgoingBytes: number;
  readonly gateWrites: number;
  readonly retries: number;
  readonly signalAttempts: number;
}

const path = new URL("./foreground53-reference.json", import.meta.url);
const admitted = lstatSync(path);
assert.ok(admitted.isFile() && !admitted.isSymbolicLink() && Number.isSafeInteger(admitted.size) && admitted.size > 0 && admitted.size <= 1048576, "Foreground reference exceeds its regular-file bound");
const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
let bytes: Buffer;
let closeFailed = false;
let closeFailure: unknown;
try {
  const before = fstatSync(descriptor);
  assert.ok(before.isFile() && Number.isSafeInteger(before.size) && before.size > 0 && before.size <= 1048576, "Foreground reference exceeds its regular-file bound");
  for (const key of ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"] as const) assert.equal(before[key], admitted[key], "Foreground reference identity changed during acquisition");
  bytes = Buffer.alloc(before.size);
  let offset = 0;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    const count = readSync(descriptor, bytes, offset, remaining, offset);
    assert.ok(Number.isSafeInteger(count) && count > 0 && count <= remaining, "Foreground reference ended early or returned an invalid byte count");
    offset += count;
  }
  assert.equal(readSync(descriptor, Buffer.alloc(1), 0, 1, offset), 0, "Foreground reference grew during reading");
  const after = fstatSync(descriptor);
  assert.ok(after.isFile());
  for (const key of ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"] as const) assert.equal(after[key], before[key], "Foreground reference identity changed during reading");
} finally {
  try { closeSync(descriptor); }
  catch (reason) { closeFailed = true; closeFailure = reason; }
}
if (closeFailed) throw closeFailure;

const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
assert.equal(digest(bytes), "9b2ea50041ed6a3b944b1dd3d85694bb1fe6caf916d5ba17e9433ec71e453804");
const reference = JSON.parse(bytes.toString()) as {
  readonly format: number;
  readonly classification: string;
  readonly profile: Profile;
  readonly qualification: Qualification;
  readonly records: readonly { readonly id: number; readonly startup: string; readonly result: string; readonly authenticationAfter: string }[];
  readonly artifacts: Readonly<Record<string, Artifact>>;
};
assert.equal(reference.format, 1);
assert.ok(reference.classification.includes("inert data"));
assert.equal(reference.profile.platform, "darwin");
assert.equal(reference.profile.arch, "arm64");
assert.equal(reference.profile.nodeVersion, "v22.23.2");
assert.equal(reference.qualification.kind, "observation");
assert.equal(reference.qualification.deterministicGolden, false);
assert.equal(reference.qualification.productReplay, false);
assert.equal(reference.qualification.internalStateTrace, false);
assert.ok(reference.qualification.note.includes("not a universal"));
assert.equal(Object.keys(reference.artifacts).length, 42);
for (const [name, entry] of Object.entries(reference.artifacts)) {
  assert.ok([".json", ".mjs", ".bash"].some(extension => name.endsWith(extension)));
  assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= 65536);
  assert.equal(Buffer.byteLength(entry.contents), entry.bytes);
  assert.equal(digest(entry.contents), entry.sha256);
}
function artifact(name: string): Artifact {
  const entry = reference.artifacts[name];
  assert.ok(entry, `Missing foreground artifact ${name}`);
  return entry;
}
function decode<Value>(name: string): Value { return JSON.parse(artifact(name).contents) as Value; }

const resultsSHA256 = "14b1176ee7486c107d0a7a44494500b3c5e713b01a1cb9cc17f607b8a260e0f4";
const sealSHA256 = "cdc0c2d1052247fc3bcac1c303a428b728705c78a4d540180bbbad941ca9cc3b";
const verificationSHA256 = "19ba639fb6a5a529c4f6fef6e4d6eefa3da2760bf0ed0e4ceb043c29ce515721";
assert.equal(artifact("results.json").sha256, resultsSHA256);
assert.equal(artifact("seal.json").sha256, sealSHA256);
assert.equal(artifact("verified.json").sha256, verificationSHA256);
const seal = decode<Seal>("seal.json");
const verification = decode<Verification>("verified.json");
const aggregate = decode<{ readonly results: readonly Result[]; readonly retries: number }>("results.json");
const subjects = decode<{ readonly subjects: readonly Subject[] }>("subjects.json").subjects;
assert.equal(seal.executionApproved, true);
assert.equal(aggregate.retries, 0);
assert.equal(aggregate.results.length, 4);
assert.equal(subjects.length, 4);
assert.equal(seal.subjects.length, 4);
assert.equal(reference.records.length, 4);
assert.equal(verification.observations.length, 4);
assert.equal(seal.bindings.bash?.sha256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
assert.equal(seal.bindings.node?.sha256, "18e387c90ab8a8400183e8bdd396376e1e875b91b4c874b894dcade7b35bf572");
assert.equal(Object.keys(seal.bindings).length, 16);
for (const [role, binding] of Object.entries(seal.bindings)) {
  if (role === "bash" || role === "node") continue;
  const stored = Object.values(reference.artifacts).find(entry => entry.path === binding.path);
  assert.ok(stored);
  assert.equal(stored.sha256, binding.sha256);
}
for (const receipt of verification.inputs) {
  const stored = Object.values(reference.artifacts).find(entry => entry.path === receipt.path);
  assert.ok(stored);
  assert.equal(stored.sha256, receipt.sha256);
  assert.equal(stored.bytes, receipt.bytes);
}
assert.equal(artifact("independent-approval.json").sha256, seal.rootApproval.independentReview.sha256);
assert.equal(artifact("root-admission.json").sha256, seal.rootApproval.heldInputAdmission.sha256);
assert.equal(artifact("prepared-checkpoint-v2.json").sha256, seal.rootApproval.checkpointSHA256);
const inventory = decode<{ readonly bindings: Readonly<Record<string, Receipt>>; readonly profile: Profile }>("inventory-before.json");
const afterInventory = decode<Readonly<Record<string, Receipt>>>("inventory-after.json");
assert.deepEqual(inventory.bindings, afterInventory);
assert.deepEqual(reference.profile, inventory.profile);
const outerAdmission = decode<{ readonly bindings: Readonly<Record<string, Receipt>>; readonly sealSHA256: string }>("outer-admission.json");
assert.equal(outerAdmission.sealSHA256, sealSHA256);
assert.deepEqual(outerAdmission.bindings, decode("outer-authentication-after.json"));
const outer = decode<{ readonly code: number; readonly signal: null; readonly runnerLaunchAttempts: number; readonly outerSignals: number; readonly outputBudgetExceeded: boolean; readonly handle: { readonly closed: boolean; readonly stdoutDestroyed: boolean; readonly stderrDestroyed: boolean } }>("outer-result.json");
assert.equal(outer.code, 0);
assert.equal(outer.signal, null);
assert.equal(outer.runnerLaunchAttempts, 1);
assert.equal(outer.outerSignals, 0);
assert.equal(outer.outputBudgetExceeded, false);
assert.equal(outer.handle.closed, true);
assert.equal(outer.handle.stdoutDestroyed, true);
assert.equal(outer.handle.stderrDestroyed, true);
const closure = decode<{ readonly handles: readonly { readonly path: string; readonly closed: boolean }[] }>("outer-admission-cleanup.json");
assert.equal(closure.handles.length, 17);
assert.equal(new Set(closure.handles.map(entry => entry.path)).size, 17);
assert.ok(closure.handles.every(entry => entry.closed));
assert.equal(verification.subjectsCompleted, 4);
assert.equal(verification.supervisorsCompleted, 4);
assert.equal(verification.closedPipes, 40);
assert.equal(verification.outerAdmissionHandlesClosed, 17);
assert.equal(verification.outgoingBytes, 56);
assert.equal(verification.gateWrites, 0);
assert.equal(verification.retries, 0);
assert.equal(verification.signalAttempts, 0);

const observations = new Map<number, { readonly result: Result; readonly startup: Startup }>();
for (const [index, record] of reference.records.entries()) {
  assert.equal(record.id, index + 1);
  const result = decode<Result>(record.result);
  const startup = decode<Startup>(record.startup);
  const after = decode<Readonly<Record<string, Receipt>>>(record.authenticationAfter);
  const subject = subjects[index]!;
  const observed = verification.observations[index]!;
  assert.deepEqual(result, aggregate.results[index]);
  assert.equal(result.id, record.id);
  assert.equal(subject.id, record.id);
  assert.equal(result.source, subject.source);
  assert.equal(startup.entry.source, subject.source);
  assert.equal(result.sourceSHA256, subject.sourceSHA256);
  assert.equal(startup.sourceSHA256, subject.sourceSHA256);
  assert.equal(digest(result.source), subject.sourceSHA256);
  assert.equal(Buffer.from(result.source).toString("hex"), subject.sourceHex);
  assert.equal(startup.subjectInvocation.sourceHex, subject.sourceHex);
  assert.equal(startup.subjectInvocation.sourceLineCount, 1);
  assert.equal(startup.subjectInvocation.argv0, "shell");
  assert.equal(startup.subjectInvocation.executable, seal.bindings.bash?.path);
  assert.deepEqual(startup.subjectInvocation.argv, ["--noprofile", "--norc", "-c", result.source, "shell"]);
  assert.deepEqual(startup.subjectInvocation.argv, seal.subjects[index]!.subjectArgv);
  assert.equal(subject.input, "");
  assert.equal(result.stdinHex, "");
  assert.equal(startup.stdinHex, result.stdinHex);
  assert.equal(seal.subjects[index]!.stdinHex, result.stdinHex);
  assert.equal(seal.subjects[index]!.sourceSHA256, result.sourceSHA256);
  assert.equal(seal.subjects[index]!.sourceHex, subject.sourceHex);
  assert.deepEqual(subject.gates, []);
  assert.deepEqual(startup.environment, { LC_ALL: "C", PATH: "/__ordinary_jobs_no_external_commands__" });
  assert.equal(startup.wrapper, artifact("supervisor.bash").contents);
  assert.equal(startup.wrapperSHA256, artifact("supervisor.bash").sha256);
  assert.deepEqual(startup.admission, inventory.bindings);
  assert.deepEqual(startup.admission, after);
  for (const [role, receipt] of Object.entries(startup.admission)) {
    assert.equal(receipt.path, seal.bindings[role]?.path);
    assert.equal(receipt.sha256, seal.bindings[role]?.sha256);
  }
  for (const key of ["id", "sourceSHA256", "stdoutHex", "stderrHex", "subjectStatus"] as const) assert.equal(result[key], observed[key]);
  for (const hex of [result.stdinHex, result.stdoutHex, result.stderrHex, result.controlHex, result.sourceControlHex]) {
    assert.ok(hex.length <= 131072 && hex.length % 2 === 0 && [...hex].every(character => "0123456789abcdef".includes(character)));
  }
  assert.ok(Number.isInteger(result.subjectStatus) && result.subjectStatus >= 0 && result.subjectStatus <= 255);
  assert.equal(result.status, result.subjectStatus);
  assert.equal(result.signal, null);
  assert.equal(result.failure, undefined);
  assert.equal(result.deadlineExceeded, false);
  assert.equal(result.cleanupComplete, true);
  assert.equal(result.childClosed, true);
  assert.equal(result.startupConfirmed, true);
  assert.equal(result.localHandlesClosed, true);
  assert.equal(result.pendingWrites, 0);
  assert.equal(result.signalAttempts, 0);
  assert.equal(result.ownedPipeCount, 10);
  assert.deepEqual([...result.closedPipes].sort((left, right) => left - right), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(result.ownerReleaseState, "acknowledged");
  assert.deepEqual(result.gatesSent, []);
  assert.equal(result.sourceControlHex, "");
  assert.deepEqual(result.accounting.attempted, { stdin: 0, start: 6, gate: 0, owner: 8 });
  assert.deepEqual(result.accounting.attempted, result.accounting.acknowledged);
  assert.ok(result.accounting.combinedActualReceivedAndAttempted <= 65536);
  observations.set(record.id, { result, startup });
}
assert.equal(observations.size, 4);

export function foregroundJobReference(id: number, request?: { readonly source: string; readonly stdin: Uint8Array }) {
  const entry = observations.get(id);
  assert.ok(entry, `Missing Bash5.3 foreground observation ${id}`);
  const { result, startup } = entry;
  if (request !== undefined) {
    assert.equal(request.source, result.source, "Unknown exact foreground source request");
    assert.ok(request.stdin.byteLength <= 65536, "Foreground request input exceeds its bound");
    assert.equal(Buffer.from(request.stdin).toString("hex"), result.stdinHex, "Unknown exact foreground stdin request");
  }
  return Object.freeze({
    id, name: result.name, source: result.source, status: result.subjectStatus,
    stdin: Buffer.from(result.stdinHex, "hex"), stdout: Buffer.from(result.stdoutHex, "hex"), stderr: Buffer.from(result.stderrHex, "hex"),
    control: Buffer.from(result.controlHex, "hex"), sourceControl: Buffer.from(result.sourceControlHex, "hex"),
    request: Object.freeze({
      argv: Object.freeze([...startup.subjectInvocation.argv]), argv0: startup.subjectInvocation.argv0,
      sourceHex: startup.subjectInvocation.sourceHex, stdinHex: result.stdinHex,
      environment: Object.freeze({ ...startup.environment }), gates: Object.freeze([]),
    }),
    qualification: Object.freeze({ ...reference.qualification }),
    provenance: Object.freeze({
      resultsSHA256, sealSHA256, verificationSHA256, sourceSHA256: result.sourceSHA256,
      platform: reference.profile.platform, profile: Object.freeze({ ...reference.profile }),
    }),
  });
}
