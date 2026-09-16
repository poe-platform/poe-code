import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";

type ReferenceId = number | "R8" | "L1" | "L2";
interface Artifact { readonly path: string; readonly sha256: string; readonly bytes: number; readonly contents: string }
interface Receipt { readonly path: string; readonly sha256: string }
interface Gate { readonly fd: number; readonly after: string; readonly bytes: string }
interface Subject { readonly id: number; readonly purpose: string; readonly source: string; readonly sourceSHA256: string; readonly input: string; readonly gates: readonly Gate[] }
interface Qualification {
  readonly kind: "observation" | "exploratory" | "calibration" | "gated-replacement" | "counterfactual";
  readonly deterministicGolden: false;
  readonly productReplay: false;
  readonly note: string;
}
interface RecordBinding {
  readonly id: ReferenceId;
  readonly nativeId: number;
  readonly startup: string;
  readonly result: string;
  readonly authenticationAfter: string;
  readonly qualification: Qualification;
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
  readonly deadlineExceeded: boolean;
  readonly cleanupComplete: boolean;
  readonly childClosed: boolean;
  readonly pendingWrites: number;
  readonly signalAttempts: number;
  readonly ownedPipeCount: number;
  readonly closedPipes: readonly number[];
  readonly accounting: {
    readonly attempted: Readonly<Record<"stdin" | "start" | "gate" | "owner", number>>;
    readonly acknowledged: Readonly<Record<"stdin" | "start" | "gate" | "owner", number>>;
  };
}
interface Invocation { readonly executable: string; readonly argv: readonly string[]; readonly argv0: string; readonly sourceHex: string; readonly sourceLineCount: number }
interface Observation extends Result { readonly sourceHex: string; readonly receipts: readonly Receipt[]; readonly subjectInvocation: Invocation }
interface Startup {
  readonly entry: Subject;
  readonly argv: readonly string[];
  readonly wrapper: string;
  readonly wrapperSHA256: string;
  readonly sourceSHA256: string;
  readonly stdinHex: string;
  readonly subjectInvocation: Invocation;
  readonly environment: Readonly<Record<string, string>>;
  readonly admission: Readonly<Record<string, Receipt>>;
}
interface Seal { readonly bindings: Readonly<Record<string, Receipt>> }
interface Batch {
  readonly id: "native25" | "native3";
  readonly origin: string;
  readonly handoff: string;
  readonly seal: string;
  readonly subjects: string;
  readonly supervisor: string;
  readonly records: readonly RecordBinding[];
}
interface Handoff {
  readonly origin: string;
  readonly profile: { readonly platform: string; readonly nodeVersion: string };
  readonly seal: Receipt | { readonly receipt: Receipt };
  readonly cases: readonly Observation[];
  readonly retries: number;
  readonly signals: number;
  readonly unresolved: boolean | number;
  readonly outer: { readonly handle: { readonly closed: boolean } } | { readonly result: { readonly handle: { readonly closed: boolean } } };
  readonly admissionCleanup: { readonly handles: readonly { readonly closed: boolean }[] };
}

const path = new URL("./next53-reference.json", import.meta.url);
const admitted = lstatSync(path);
assert.ok(admitted.isFile() && !admitted.isSymbolicLink() && Number.isSafeInteger(admitted.size) && admitted.size > 0 && admitted.size <= 2097152, "Wait-option reference exceeds its regular-file bound");
const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
let bytes: Buffer;
let closeFailed = false;
let closeFailure: unknown;
try {
  const before = fstatSync(descriptor);
  assert.ok(before.isFile() && Number.isSafeInteger(before.size) && before.size > 0 && before.size <= 2097152, "Wait-option reference exceeds its regular-file bound");
  for (const key of ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"] as const) assert.equal(before[key], admitted[key], "Wait-option reference identity changed during acquisition");
  bytes = Buffer.alloc(before.size);
  let offset = 0;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    const count = readSync(descriptor, bytes, offset, remaining, offset);
    assert.ok(Number.isSafeInteger(count) && count > 0 && count <= remaining, "Wait-option reference ended early or returned an invalid byte count");
    offset += count;
  }
  assert.equal(readSync(descriptor, Buffer.alloc(1), 0, 1, offset), 0, "Wait-option reference grew during reading");
  const after = fstatSync(descriptor);
  assert.ok(after.isFile());
  for (const key of ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"] as const) assert.equal(after[key], before[key], "Wait-option reference identity changed during reading");
} finally {
  try { closeSync(descriptor); }
  catch (reason) { closeFailed = true; closeFailure = reason; }
}
if (closeFailed) throw closeFailure;

const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
assert.equal(digest(bytes), "36db38dc7603edd35966c7450a8016371a2d6f4e318fc5ebc7608b548baf78ea");
const reference = JSON.parse(bytes.toString()) as {
  readonly format: number;
  readonly classification: string;
  readonly profile: { readonly platform: string; readonly nodeVersion: string };
  readonly batches: readonly Batch[];
  readonly artifacts: Readonly<Record<string, Artifact>>;
};
assert.equal(reference.format, 1);
assert.ok(reference.classification.includes("inert historical data"));
assert.equal(reference.profile.platform, "darwin");
assert.equal(reference.profile.nodeVersion, "v22.23.2");
assert.deepEqual(reference.batches.map(batch => batch.id), ["native25", "native3"]);
assert.equal(Object.keys(reference.artifacts).length, 106);
for (const artifact of Object.values(reference.artifacts)) {
  assert.equal(typeof artifact.contents, "string");
  assert.ok(Number.isSafeInteger(artifact.bytes) && artifact.bytes >= 0 && artifact.bytes <= 524288);
  assert.equal(Buffer.byteLength(artifact.contents), artifact.bytes);
  assert.equal(digest(artifact.contents), artifact.sha256);
}

function artifact(name: string): Artifact {
  const entry = reference.artifacts[name];
  assert.ok(entry, `Missing wait-option artifact ${name}`);
  return entry;
}

function decode<Value>(name: string): Value {
  return JSON.parse(artifact(name).contents) as Value;
}

const handoffHashes = {
  native25: "0faa4d440fc5851644684a40e8debccf859bc56da0a4bf763e36a9ddf21eb672",
  native3: "1740662dff25dc49fa049298cfb6a6d8870deeaeb2b844c248f6307d6dd32bd8",
};
const sealHashes = {
  native25: "05422c0c135117a070dc57582342d77f0a5183226adbbd2ce1ffa11c512ead81",
  native3: "e6667b23474604b675c2b96eedc57e4e2303261843a929f83797dbe0a9fdf3a7",
};
const records = new Map<ReferenceId, { readonly batch: Batch; readonly binding: RecordBinding; readonly result: Result; readonly startup: Startup; readonly subject: Subject }>();
for (const batch of reference.batches) {
  assert.equal(artifact(batch.handoff).sha256, handoffHashes[batch.id]);
  assert.equal(artifact(batch.seal).sha256, sealHashes[batch.id]);
  const handoff = decode<Handoff>(batch.handoff);
  const seal = decode<Seal>(batch.seal);
  const subjects = decode<{ readonly subjects: readonly Subject[] }>(batch.subjects).subjects;
  const count = batch.id === "native25" ? 25 : 3;
  assert.equal(handoff.origin, batch.origin);
  assert.equal(handoff.profile.platform, reference.profile.platform);
  assert.equal(handoff.profile.nodeVersion, reference.profile.nodeVersion);
  const sealReceipt = "receipt" in handoff.seal ? handoff.seal.receipt : handoff.seal;
  assert.equal(sealReceipt.sha256, artifact(batch.seal).sha256);
  assert.equal(sealReceipt.path, artifact(batch.seal).path);
  assert.equal(handoff.retries, 0);
  assert.equal(handoff.signals, 0);
  assert.equal(handoff.unresolved, batch.id === "native25" ? 0 : false);
  const outer = "result" in handoff.outer ? handoff.outer.result : handoff.outer;
  assert.equal(outer.handle.closed, true);
  assert.equal(handoff.admissionCleanup.handles.length, Object.keys(seal.bindings).length + 1);
  assert.ok(handoff.admissionCleanup.handles.every(handle => handle.closed));
  assert.equal(handoff.cases.length, count);
  assert.equal(subjects.length, count);
  assert.equal(batch.records.length, count);
  assert.equal(seal.bindings.bash?.sha256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
  assert.equal(seal.bindings.node?.sha256, "18e387c90ab8a8400183e8bdd396376e1e875b91b4c874b894dcade7b35bf572");
  for (const [index, binding] of batch.records.entries()) {
    assert.equal(binding.nativeId, index + 1);
    assert.equal(binding.id, batch.id === "native25" ? index + 1 : ["R8", "L1", "L2"][index]);
    const result = decode<Result>(binding.result);
    const startup = decode<Startup>(binding.startup);
    const authentication = decode<Readonly<Record<string, Receipt>>>(binding.authenticationAfter);
    const observation = handoff.cases[index]!;
    const subject = subjects[index]!;
    assert.equal(result.id, binding.nativeId);
    assert.equal(subject.id, binding.nativeId);
    assert.equal(observation.id, binding.nativeId);
    for (const name of [binding.result, binding.startup, binding.authenticationAfter]) {
      const entry = artifact(name);
      assert.equal(observation.receipts.find(receipt => receipt.path === entry.path)?.sha256, entry.sha256);
    }
    for (const [role, name] of [["subjects", batch.subjects], ["supervisor", batch.supervisor], ["runner", `${batch.id}/capture.mjs`], ["outer", `${batch.id}/outer.mjs`]] as const) {
      assert.equal(seal.bindings[role]?.sha256, artifact(name).sha256);
      assert.equal(startup.admission[role]?.sha256, artifact(name).sha256);
      assert.equal(authentication[role]?.sha256, artifact(name).sha256);
    }
    assert.deepEqual(authentication, startup.admission);
    for (const role of ["bash", "node"] as const) assert.equal(startup.admission[role]?.sha256, seal.bindings[role]?.sha256);
    assert.equal(result.source, subject.source);
    assert.equal(result.sourceSHA256, subject.sourceSHA256);
    assert.equal(digest(result.source), subject.sourceSHA256);
    assert.equal(startup.entry.source, subject.source);
    assert.equal(startup.sourceSHA256, subject.sourceSHA256);
    assert.equal(startup.argv[3], artifact(batch.supervisor).contents);
    assert.equal(startup.argv[5], result.source);
    assert.equal(startup.wrapper, artifact(batch.supervisor).contents);
    assert.equal(startup.wrapperSHA256, artifact(batch.supervisor).sha256);
    assert.deepEqual(startup.subjectInvocation, observation.subjectInvocation);
    assert.deepEqual(startup.subjectInvocation.argv, ["--noprofile", "--norc", "-c", result.source, "shell"]);
    assert.equal(startup.subjectInvocation.argv0, "shell");
    assert.equal(startup.subjectInvocation.sourceLineCount, 1);
    assert.equal(startup.subjectInvocation.sourceHex, Buffer.from(result.source).toString("hex"));
    assert.equal(startup.subjectInvocation.sourceHex, observation.sourceHex);
    assert.deepEqual(startup.environment, { LC_ALL: "C", PATH: "/__ordinary_jobs_no_external_commands__" });
    assert.equal(Buffer.from(subject.input).toString("hex"), result.stdinHex);
    assert.equal(startup.stdinHex, result.stdinHex);
    for (const field of ["source", "sourceSHA256", "stdinHex", "stdoutHex", "stderrHex", "controlHex", "sourceControlHex", "subjectStatus"] as const) assert.equal(result[field], observation[field]);
    for (const hex of [result.stdinHex, result.stdoutHex, result.stderrHex, result.controlHex, result.sourceControlHex]) {
      assert.ok(hex.length <= 131072 && hex.length % 2 === 0 && [...hex].every(character => "0123456789abcdef".includes(character)));
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
    assert.deepEqual([...result.closedPipes].sort((left, right) => left - right), [0,1,2,3,4,5,6,7,8,9]);
    assert.deepEqual(result.accounting.attempted, result.accounting.acknowledged);
    assert.equal(result.accounting.attempted.stdin, 0);
    assert.equal(result.accounting.attempted.start, 6);
    assert.equal(result.accounting.attempted.owner, 8);
    assert.equal(result.accounting.attempted.gate, subject.gates.reduce((sum, gate) => sum + Buffer.byteLength(gate.bytes), 0));
    const kind = binding.id === 12 ? "exploratory" : binding.id === 25 ? "calibration" : binding.id === "R8" ? "gated-replacement" : typeof binding.id === "string" ? "counterfactual" : "observation";
    assert.equal(binding.qualification.kind, kind);
    assert.equal(binding.qualification.deterministicGolden, false);
    assert.equal(binding.qualification.productReplay, false);
    if (binding.id === 12) assert.ok(binding.qualification.note.includes("NEVER"));
    assert.equal(records.has(binding.id), false);
    records.set(binding.id, { batch, binding, result, startup, subject });
  }
}
assert.equal(records.size, 28);
assert.equal(records.get(25)!.result.stderrHex, records.get("R8")!.result.stderrHex);
assert.equal(Buffer.from(records.get(25)!.result.stderrHex, "hex").length, 130);

export function nextJobReference(id: ReferenceId, request?: { readonly source: string; readonly stdin: Uint8Array }) {
  const entry = records.get(id);
  assert.ok(entry, `Missing Bash5.3 wait-option observation ${id}`);
  const { batch, binding, result, startup, subject } = entry;
  if (request !== undefined) {
    assert.equal(request.source, result.source, "Unknown exact wait-option source request");
    assert.ok(request.stdin.byteLength <= 65536, "Wait-option request input exceeds its bound");
    assert.equal(Buffer.from(request.stdin).toString("hex"), result.stdinHex, "Unknown exact wait-option stdin request");
  }
  return Object.freeze({
    id, name: result.name, source: result.source, status: result.subjectStatus,
    stdin: Buffer.from(result.stdinHex, "hex"), stdout: Buffer.from(result.stdoutHex, "hex"), stderr: Buffer.from(result.stderrHex, "hex"),
    control: Buffer.from(result.controlHex, "hex"), sourceControl: Buffer.from(result.sourceControlHex, "hex"),
    request: Object.freeze({
      argv: Object.freeze([...startup.subjectInvocation.argv]), argv0: startup.subjectInvocation.argv0,
      sourceHex: startup.subjectInvocation.sourceHex, stdinHex: result.stdinHex,
      environment: Object.freeze({ ...startup.environment }),
      gates: Object.freeze(subject.gates.map(gate => Object.freeze({ fd: gate.fd, after: gate.after, bytesHex: Buffer.from(gate.bytes).toString("hex") }))),
    }),
    qualification: Object.freeze({ ...binding.qualification }),
    provenance: Object.freeze({
      batch: batch.id, nativeId: binding.nativeId, handoffSHA256: handoffHashes[batch.id], sealSHA256: sealHashes[batch.id],
      sourceSHA256: result.sourceSHA256, platform: reference.profile.platform,
    }),
  });
}
