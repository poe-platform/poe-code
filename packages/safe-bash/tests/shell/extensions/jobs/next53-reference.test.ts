import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";

type Id = number | "R8" | "L1" | "L2";
interface Observation {
  readonly id: Id;
  readonly source: string;
  readonly status: number;
  readonly stdin: Buffer;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly control: Buffer;
  readonly sourceControl: Buffer;
  readonly request: {
    readonly argv: readonly string[];
    readonly argv0: string;
    readonly sourceHex: string;
    readonly stdinHex: string;
    readonly environment: Readonly<Record<string, string>>;
    readonly gates: readonly { readonly fd: number; readonly after: string; readonly bytesHex: string }[];
  };
  readonly qualification: { readonly kind: string; readonly deterministicGolden: false; readonly productReplay: false; readonly note: string };
  readonly provenance: { readonly handoffSHA256: string; readonly sealSHA256: string; readonly sourceSHA256: string; readonly platform: string };
}
type Lookup = (id: Id, request?: { readonly source: string; readonly stdin: Uint8Array }) => Observation;
interface Metadata {
  readonly size: number;
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  isFile(): boolean;
}
interface StaticReader {
  lstatSync(url: URL): Metadata & { isSymbolicLink(): boolean };
  openSync(url: URL, flags: number): number;
  fstatSync(descriptor: number): Metadata;
  readSync(descriptor: number, buffer: Buffer, offset: number, length: number, position: number): number;
  closeSync(descriptor: number): void;
}
interface Trace { preflights: number; opens: number; stats: number; reads: number; closes: number; releases: number; parses: number; flags?: number }
interface CombinedFault { readonly primary: unknown; readonly cleanup: unknown; readonly closeBeforeRelease?: boolean }
type Fault = "none" | "short" | "not-file" | "oversize" | "empty" | "negative-size" | "fractional-size" | "nan-size" | "early-eof" | "growth" | "stat-failure" | "read-failure" | "open-failure" | "close-failure" | "digest" | "oversized-count" | "negative-count" | "fractional-count" | "nan-count" | "post-stat-drift" | "preflight-not-file" | "preflight-symlink" | "preflight-oversize" | "preflight-empty" | "preflight-negative-size" | "preflight-fractional-size" | "preflight-nan-size" | "preflight-failure" | "acquisition-drift";

const ids: readonly Id[] = [...Array.from({ length: 25 }, (_, index) => index + 1), "R8", "L1", "L2"];
const expectedDigests: readonly string[] = ["7c55364ecc28a8b506eba4547e2c497e7b46ec1ddc0a93cb26b317b1ae438f02","6de9be85e60f9642fc35d6a21681303133b4ac562ea7eab872f863801dc87f3c","be3e17aeaf60fa91751f7cf3b9574e5a9e4c5be4465a7d60d383cb7a4ff7140d","843d73d9309d1caa156047c9b691cb831bdd082882f3f7cca1601372ec2ce6ad","7f1937b2d7c933369994426ac8c6881400fd4ebc0d8961725d0d8f9a9997fd69","97cea98cf4414a7e158cf28fb18aded06c9b17e59a5be9be9c7cd95baa8be949","a5cd1abd202f97628c567287ec242a8557b283cb1fd4d302184e59cc996161de","d097d9b333564b9ee772b25ff6d59c4ce701f7dd4aa22526aa3d4883abff9a9d","d860ade7172376bf1386cef6b4e4b614349b6ef091dc5bd3022602177afa0db3","210113f2cb1d436b0d2cb3eb8462863bf424b3dbf0d58bc521986ac49b1e7be6","1c6bf7d648b0137666be57da29a197a6c204bd27fbcdffe71354af5ed5d00dfd","b8d1d362aa26daa8d1468f55ac61861f2bac57c21376724551abbf7ffd91648a","a683bf6d38421c2adc21e08ef5ea9dbe2efb93495f9a1258ab58459d4f540a6e","fcbb8dae4a2dc7f880ef903552ee909a2f17849716f908eaa11db6d01955ecf0","181e8df4588df5bc3686fac8ea03dc3b90fa1b7fb106453b8cb93a9a9fa5a15c","d85a158f4075555f6ef2eab9c508a83df73f1ba1cd94074b8a81ef51ee509949","8ee5227647479d3b56bf143970c949fbdeb7ae2f821935f176c8b3aac71ebddf","142005524913829cf82d8a11ec86c0f9766457bef9ae077b1a83a78494fe19a1","4490403c4a91f7dd2a4de5b015e78f84be39726159e701e4108456a137a70469","93bc53f7f6f0f21eb745ba0521e3044a6b40a799d46bea915363b16342693675","331475e057eafbf2c401f4b39f64db3e7145fa11de0ea518a5331ee4138c600a","03bf82d33237cc7121cafeb417e15aa20ae2294503f96df16d7be21589362d07","4faa3652ac639e0ce853c2ee3e6d7b3489c629e70f079a62ef1208312fbbf376","cdd769a71b5694de1a1dc08e410d6946e4605bafd2dd657c2b0e8c5633678047","2e9714c389d54104946c5d3a32f5034da69bf3fdb4813b59315876c972fbc8ff","25c0b5f0b55754e82d291cf84e15bafcadab8e408a19b6ed9ac47f8525262b6f","f3c2645894c66dec35dd3c94109a50cac2cb5c6ce5d766de0729c31cb844ee08","3d3ada9ce7e746029567510bf5d2cb964da1c282127aef1b812484b8bed0f043"];
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const trace = (): Trace => ({ preflights: 0, opens: 0, stats: 0, reads: 0, closes: 0, releases: 0, parses: 0 });
function readStatic(url: URL, maximum: number, filesystem: StaticReader = { closeSync, fstatSync, lstatSync, openSync, readSync }): Buffer {
  const admitted = filesystem.lstatSync(url);
  assert.ok(admitted.isFile() && !admitted.isSymbolicLink() && Number.isSafeInteger(admitted.size) && admitted.size > 0 && admitted.size <= maximum, "Static input exceeds its regular-file bound");
  const descriptor = filesystem.openSync(url, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  let closeFailed = false;
  let closeFailure: unknown;
  try {
    const before = filesystem.fstatSync(descriptor);
    assert.ok(before.isFile() && Number.isSafeInteger(before.size) && before.size > 0 && before.size <= maximum, "Static input exceeds its regular-file bound");
    for (const key of ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"] as const) assert.equal(before[key], admitted[key], "Static input identity changed during acquisition");
    bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const remaining = bytes.length - offset;
      const count = filesystem.readSync(descriptor, bytes, offset, remaining, offset);
      assert.ok(Number.isSafeInteger(count) && count > 0 && count <= remaining, "Static input ended early or returned an invalid byte count");
      offset += count;
    }
    assert.equal(filesystem.readSync(descriptor, Buffer.alloc(1), 0, 1, offset), 0, "Static input grew during reading");
    const after = filesystem.fstatSync(descriptor);
    assert.ok(after.isFile());
    for (const key of ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"] as const) assert.equal(after[key], before[key], "Static input identity changed during reading");
  } finally {
    try { filesystem.closeSync(descriptor); }
    catch (reason) { closeFailed = true; closeFailure = reason; }
  }
  if (closeFailed) throw closeFailure;
  return bytes;
}
const fixture = () => readStatic(new URL("./next53-reference.json", import.meta.url), 2097152);
let compiled: string | undefined;

async function canonical(): Promise<Lookup> {
  return (await import("./next53-reference.js")).nextJobReference;
}

function mockFilesystem(fault: Fault, calls: Trace, reason: unknown, override?: Buffer, combined?: CombinedFault) {
  const bytes = Buffer.from(override ?? fixture());
  if (fault === "digest") bytes[0] = 32;
  const memory = createFsFromVolume(Volume.fromJSON({ "/next-fixture/next53-reference.json": bytes }));
  return {
    constants,
    lstatSync(url: URL) {
      calls.preflights++;
      if (fault === "preflight-failure") throw reason;
      const stat = memory.lstatSync(fileURLToPath(url));
      const sizes: Partial<Record<Fault, number>> = { "preflight-oversize": 2097153, "preflight-empty": 0, "preflight-negative-size": -1, "preflight-fractional-size": 1.5, "preflight-nan-size": NaN };
      return {
        size: sizes[fault] ?? Number(stat.size), dev: Number(stat.dev), ino: Number(stat.ino), mode: Number(stat.mode),
        mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs),
        isFile: () => fault !== "preflight-not-file" && stat.isFile(),
        isSymbolicLink: () => fault === "preflight-symlink",
      };
    },
    openSync(url: URL, flags: number) {
      calls.opens++;
      calls.flags = flags;
      assert.equal(fileURLToPath(url), "/next-fixture/next53-reference.json");
      if (fault === "open-failure") throw reason;
      return memory.openSync(fileURLToPath(url), flags);
    },
    fstatSync(descriptor: number) {
      calls.stats++;
      if (fault === "stat-failure") throw combined ? combined.primary : reason;
      const stat = memory.fstatSync(descriptor);
      const sizes: Partial<Record<Fault, number>> = { oversize: 2097153, empty: 0, "negative-size": -1, "fractional-size": 1.5, "nan-size": NaN };
      return {
        size: sizes[fault] ?? Number(stat.size), dev: Number(stat.dev), ino: Number(stat.ino) + (fault === "acquisition-drift" ? 1 : 0), mode: Number(stat.mode),
        mtimeMs: Number(stat.mtimeMs) + (fault === "post-stat-drift" && calls.stats === 2 ? 1 : 0), ctimeMs: Number(stat.ctimeMs),
        isFile: () => fault !== "not-file" && stat.isFile(),
      };
    },
    readSync(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
      calls.reads++;
      if (fault === "read-failure") throw combined ? combined.primary : reason;
      if (fault === "early-eof") return 0;
      if (fault === "growth" && position === bytes.length) { buffer[offset] = 32; return 1; }
      if (fault === "oversized-count") return length + 1;
      if (fault === "negative-count") return -1;
      if (fault === "fractional-count") return 0.5;
      if (fault === "nan-count") return NaN;
      return memory.readSync(descriptor, buffer, offset, fault === "short" ? Math.min(length, 4096) : length, position);
    },
    closeSync(descriptor: number) {
      calls.closes++;
      if (combined?.closeBeforeRelease) throw combined.cleanup;
      memory.closeSync(descriptor);
      calls.releases++;
      if (combined) throw combined.cleanup;
      if (fault === "close-failure") throw reason;
    },
  };
}

function evaluate(fault: Fault, calls: Trace, reason: unknown = new Error(`injected ${fault}`), override?: Buffer, combined?: CombinedFault): Lookup {
  if (compiled === undefined) {
    const source = readStatic(new URL("./next53-reference.ts", import.meta.url), 65536).toString();
    compiled = ts.transpileModule(source.replace("import.meta.url", JSON.stringify("file:///next-fixture/next53-reference.ts")), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
    }).outputText;
  }
  const filesystem = mockFilesystem(fault, calls, reason, override, combined);
  const exports: { nextJobReference?: Lookup } = {};
  runInNewContext(`const originalParse = JSON.parse; JSON.parse = (...args) => { noteParse(); return originalParse(...args); };\n${compiled}`, {
    exports, Buffer, URL, noteParse() { calls.parses++; },
    require(name: string) {
      if (name === "node:assert/strict") return assert;
      if (name === "node:crypto") return { createHash };
      if (name === "node:fs") return filesystem;
      throw new Error(`Unapproved next-reference import: ${name}`);
    },
  }, { timeout: 1000 });
  assert.equal(typeof exports.nextJobReference, "function");
  return exports.nextJobReference!;
}

for (const fault of ["preflight-not-file", "preflight-symlink", "preflight-oversize", "preflight-empty", "preflight-negative-size", "preflight-fractional-size", "preflight-nan-size", "preflight-failure"] as const) test(`static-reader ${fault} refuses before payload access`, () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///next-fixture/next53-reference.json"), 2097152, mockFilesystem(fault, calls, new Error(fault))));
  assert.equal(calls.preflights, 1);
  assert.equal(calls.opens, 0);
  assert.equal(calls.reads, 0);
  assert.equal(calls.closes, 0);
});

for (const fault of ["not-file", "oversize", "empty", "negative-size", "fractional-size", "nan-size", "acquisition-drift", "early-eof", "growth", "post-stat-drift", "oversized-count", "negative-count", "fractional-count", "nan-count"] as const) test(`static-reader ${fault} rejects held admission or read failure and closes once`, () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///next-fixture/next53-reference.json"), 2097152, mockFilesystem(fault, calls, new Error(fault))));
  assert.equal(calls.opens, 1);
  assert.equal(calls.closes, 1);
  if (["not-file", "oversize", "empty", "negative-size", "fractional-size", "nan-size", "acquisition-drift"].includes(fault)) assert.equal(calls.reads, 0);
});

for (const primary of [undefined, null, false, 0, ""]) test(`static-reader combined read/close preserves ${String(primary)}`, () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///next-fixture/next53-reference.json"), 2097152, mockFilesystem("read-failure", calls, undefined, undefined, { primary, cleanup: new Error("close failure") })), actual => Object.is(actual, primary));
  assert.equal(calls.opens, 1);
  assert.equal(calls.closes, 1);
});

for (const fault of ["none", "short"] as const) test(`static-reader ${fault} reads admitted bytes and closes once`, () => {
  const calls = trace();
  assert.deepEqual(readStatic(new URL("file:///next-fixture/next53-reference.json"), 2097152, mockFilesystem(fault, calls, undefined)), fixture());
  assert.equal(calls.preflights, 1);
  assert.equal(calls.opens, 1);
  assert.equal(calls.closes, 1);
  assert.equal(calls.stats, 2);
  assert.ok(calls.reads >= 2);
});

test("static source reader enforces its smaller bound before opening", () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///next-fixture/next53-reference.json"), 65536, mockFilesystem("none", calls, undefined)));
  assert.equal(calls.opens, 0);
  assert.equal(calls.reads, 0);
});

for (const cleanup of [undefined, null, false, 0, ""]) {
  test(`helper standalone close failure preserves ${String(cleanup)} before parsing`, () => {
    const calls = trace();
    assert.throws(() => evaluate("none", calls, undefined, undefined, { primary: undefined, cleanup }), actual => Object.is(actual, cleanup));
    assert.equal(calls.closes, 1);
    assert.equal(calls.releases, 1);
    assert.equal(calls.parses, 0);
  });
  test(`static-reader standalone close failure preserves ${String(cleanup)}`, () => {
    const calls = trace();
    assert.throws(() => readStatic(new URL("file:///next-fixture/next53-reference.json"), 2097152, mockFilesystem("close-failure", calls, cleanup)), actual => Object.is(actual, cleanup));
    assert.equal(calls.closes, 1);
    assert.equal(calls.releases, 1);
  });
}

for (const target of ["helper", "static-reader"] as const) test(`${target} does not retry a close failure with unresolved ownership`, () => {
  const calls = trace();
  const cleanup = new Error("ambiguous close failure");
  const combined = { primary: undefined, cleanup, closeBeforeRelease: true };
  assert.throws(() => target === "helper"
    ? evaluate("none", calls, undefined, undefined, combined)
    : readStatic(new URL("file:///next-fixture/next53-reference.json"), 2097152, mockFilesystem("none", calls, undefined, undefined, combined)), actual => actual === cleanup);
  assert.equal(calls.closes, 1);
  assert.equal(calls.releases, 0);
  assert.equal(calls.parses, 0);
});

test("static-reader held stat plus close failure retains falsey primary", () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///next-fixture/next53-reference.json"), 2097152, mockFilesystem("stat-failure", calls, undefined, undefined, { primary: 0, cleanup: new Error("close failure") })), actual => actual === 0);
  assert.equal(calls.closes, 1);
  assert.equal(calls.reads, 0);
});

test("static-reader byte validation plus close failure preserves validation", () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///next-fixture/next53-reference.json"), 2097152, mockFilesystem("early-eof", calls, undefined, undefined, { primary: undefined, cleanup: false })), { message: "Static input ended early or returned an invalid byte count" });
  assert.equal(calls.closes, 1);
});

for (const fault of ["preflight-not-file", "preflight-symlink", "preflight-oversize", "preflight-empty", "preflight-negative-size", "preflight-fractional-size", "preflight-nan-size", "preflight-failure"] as const) test(`pre-open ${fault} refuses without opening or reading`, () => {
  const calls = trace();
  assert.throws(() => evaluate(fault, calls));
  assert.equal(calls.preflights, 1);
  assert.equal(calls.opens, 0);
  assert.equal(calls.reads, 0);
  assert.equal(calls.closes, 0);
  assert.equal(calls.parses, 0);
});

test("held identity must match admitted metadata before reading", () => {
  const calls = trace();
  assert.throws(() => evaluate("acquisition-drift", calls));
  assert.equal(calls.preflights, 1);
  assert.equal(calls.opens, 1);
  assert.equal(calls.reads, 0);
  assert.equal(calls.closes, 1);
  assert.equal(calls.parses, 0);
});

for (const primary of [undefined, null, false, 0, ""]) test(`read plus close failure preserves primary ${String(primary)} without retry`, () => {
  const calls = trace();
  const cleanup = new Error("secondary close failure");
  assert.throws(() => evaluate("read-failure", calls, undefined, undefined, { primary, cleanup }), actual => Object.is(actual, primary));
  assert.equal(calls.opens, 1);
  assert.equal(calls.closes, 1);
  assert.equal(calls.parses, 0);
});

test("held stat plus close failure preserves falsey primary without retry", () => {
  const calls = trace();
  assert.throws(() => evaluate("stat-failure", calls, undefined, undefined, { primary: 0, cleanup: new Error("secondary close failure") }), actual => actual === 0);
  assert.equal(calls.closes, 1);
  assert.equal(calls.reads, 0);
  assert.equal(calls.parses, 0);
});

test("byte-count validation plus close failure preserves validation failure", () => {
  const calls = trace();
  assert.throws(() => evaluate("early-eof", calls, undefined, undefined, { primary: undefined, cleanup: false }), { message: "Wait-option reference ended early or returned an invalid byte count" });
  assert.equal(calls.closes, 1);
  assert.equal(calls.parses, 0);
});

for (const [index, id] of ids.entries()) test(`native wait observation ${id} retains exact request and raw effects`, async () => {
  const lookup = await canonical();
  const actual = lookup(id);
  assert.equal(actual.id, id);
  assert.equal(digest(JSON.stringify({ source: actual.source, stdinHex: actual.stdin.toString("hex"), stdoutHex: actual.stdout.toString("hex"), stderrHex: actual.stderr.toString("hex"), status: actual.status })), expectedDigests[index]);
  assert.deepEqual(actual.request.argv, ["--noprofile", "--norc", "-c", actual.source, "shell"]);
  assert.equal(actual.request.argv0, "shell");
  assert.equal(actual.request.sourceHex, Buffer.from(actual.source).toString("hex"));
  assert.equal(actual.request.stdinHex, actual.stdin.toString("hex"));
  assert.deepEqual(actual.request.environment, { LC_ALL: "C", PATH: "/__ordinary_jobs_no_external_commands__" });
  assert.equal(actual.provenance.sourceSHA256, digest(actual.source));
  assert.equal(actual.provenance.platform, "darwin");
  assert.equal(actual.qualification.deterministicGolden, false);
  assert.equal(actual.qualification.productReplay, false);
});

test("both source handoffs and every embedded artifact retain their exact bytes", async () => {
  await canonical();
  const bytes = fixture();
  assert.equal(digest(bytes), "36db38dc7603edd35966c7450a8016371a2d6f4e318fc5ebc7608b548baf78ea");
  const data = JSON.parse(bytes.toString()) as { format: number; artifacts: Record<string, { bytes: number; contents: string; sha256: string }>; batches: { records: unknown[] }[] };
  assert.equal(data.format, 1);
  assert.equal(Object.keys(data.artifacts).length, 106);
  assert.deepEqual(data.batches.map(batch => batch.records.length), [25, 3]);
  for (const artifact of Object.values(data.artifacts)) {
    assert.equal(Buffer.byteLength(artifact.contents), artifact.bytes);
    assert.equal(digest(artifact.contents), artifact.sha256);
  }
  assert.equal(data.artifacts["native25/handoff.json"]?.sha256, "0faa4d440fc5851644684a40e8debccf859bc56da0a4bf763e36a9ddf21eb672");
  assert.equal(data.artifacts["native3/handoff.json"]?.sha256, "1740662dff25dc49fa049298cfb6a6d8870deeaeb2b844c248f6307d6dd32bd8");
});

test("exploration, calibration, replacement and counterfactual qualifications stay distinct", async () => {
  const lookup = await canonical();
  assert.equal(lookup(12).qualification.kind, "exploratory");
  assert.ok(lookup(12).qualification.note.includes("NEVER"));
  assert.equal(lookup(25).qualification.kind, "calibration");
  assert.equal(lookup("R8").qualification.kind, "gated-replacement");
  assert.equal(lookup("L1").qualification.kind, "counterfactual");
  assert.equal(lookup("L2").qualification.kind, "counterfactual");
  assert.equal(lookup(25).stderr.length, 130);
  assert.deepEqual(lookup("R8").stderr, lookup(25).stderr);
  assert.deepEqual(lookup("R8").request.gates, [{ fd: 3, after: "CALIBRATION25_STDERR", bytesHex: "72656c656173650a" }]);
  assert.deepEqual(lookup("L1").request.gates, []);
  assert.deepEqual(lookup("L2").request.gates, []);
});

test("raw FF diagnostic bytes remain FF rather than replacement text", async () => {
  const lookup = await canonical();
  assert.ok(lookup(3).stderr.includes(255));
  assert.equal(lookup(3).stderr.includes(Buffer.from([239, 191, 189])), false);
});

test("exact request matching rejects changes and unknown identities without normalization", async () => {
  const lookup = await canonical();
  const actual = lookup(1);
  assert.equal(lookup(1, { source: actual.source, stdin: actual.stdin }).source, actual.source);
  assert.throws(() => lookup(1, { source: actual.source + " ", stdin: actual.stdin }));
  assert.throws(() => lookup(1, { source: actual.source, stdin: Buffer.from([0]) }));
  assert.throws(() => lookup(2, { source: actual.source, stdin: actual.stdin }));
  for (const id of [0, 26, -1, 1.5, NaN, Infinity, "1", "r8", "unknown"]) assert.throws(() => lookup(id as Id));
});

test("metadata is frozen and returned buffers cannot mutate the canonical observation", async () => {
  const lookup = await canonical();
  const original = lookup("R8");
  const changed = lookup("R8");
  for (const name of ["stdin", "stdout", "stderr", "control", "sourceControl"] as const) {
    assert.notEqual(changed[name], original[name]);
    changed[name].fill(0);
    assert.deepEqual(lookup("R8")[name], original[name]);
  }
  for (const value of [changed, changed.request, changed.request.argv, changed.request.environment, changed.request.gates, changed.request.gates[0], changed.qualification, changed.provenance]) assert.equal(Object.isFrozen(value), true);
  assert.equal(Reflect.set(changed.qualification, "deterministicGolden", true), false);
  assert.equal(Reflect.set(changed.request.argv, "3", ":"), false);
  assert.equal(lookup(12).qualification.deterministicGolden, false);
});

for (const fault of ["none", "short"] as const) test(`memfs ${fault} admission closes once without native or tmp reads`, async () => {
  await canonical();
  const calls = trace();
  const lookup = evaluate(fault, calls);
  assert.equal(lookup("R8").qualification.kind, "gated-replacement");
  assert.equal(calls.opens, 1);
  assert.equal(calls.closes, 1);
  assert.equal(calls.flags, constants.O_RDONLY | constants.O_NOFOLLOW);
  assert.equal(calls.stats, 2);
  assert.ok(calls.parses > 0);
  if (fault === "short") assert.ok(calls.reads > 2);
});

for (const fault of ["not-file", "oversize", "empty", "negative-size", "fractional-size", "nan-size", "early-eof", "growth", "stat-failure", "read-failure", "close-failure", "digest", "oversized-count", "negative-count", "fractional-count", "nan-count", "post-stat-drift"] as const) test(`memfs ${fault} fails closed before parsing`, async () => {
  await canonical();
  const calls = trace();
  assert.throws(() => evaluate(fault, calls));
  assert.equal(calls.opens, 1);
  assert.equal(calls.closes, 1);
  assert.equal(calls.parses, 0);
});

for (const fault of ["open-failure", "stat-failure", "read-failure", "close-failure"] as const) test(`memfs ${fault} retains falsey failure identity`, async () => {
  await canonical();
  const calls = trace();
  assert.throws(() => evaluate(fault, calls, 0), reason => reason === 0);
  assert.equal(calls.closes, fault === "open-failure" ? 0 : 1);
  assert.equal(calls.parses, 0);
});

for (const change of ["schema", "source", "stdin", "stdout", "qualification", "missing-record", "missing-artifact"] as const) test(`static ${change} mutation cannot waive authenticated observations`, async () => {
  await canonical();
  const data = JSON.parse(fixture().toString()) as { format: number; batches: { records: { qualification: { deterministicGolden: boolean } }[] }[]; artifacts: Record<string, { contents: string }> };
  if (change === "schema") data.format = 2;
  else if (change === "qualification") data.batches[0]!.records[11]!.qualification.deterministicGolden = true;
  else if (change === "missing-record") data.batches[0]!.records.pop();
  else if (change === "missing-artifact") delete data.artifacts["native25/capture.mjs"];
  else {
    const record = JSON.parse(data.artifacts["native25/case-1-result.json"]!.contents) as Record<string, unknown>;
    record[change === "source" ? "source" : `${change}Hex`] = change === "source" ? ":" : "ff";
    data.artifacts["native25/case-1-result.json"]!.contents = JSON.stringify(record);
  }
  const calls = trace();
  assert.throws(() => evaluate("none", calls, undefined, Buffer.from(JSON.stringify(data))));
  assert.equal(calls.closes, 1);
  assert.equal(calls.parses, 0);
});
