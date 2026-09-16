import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";

type Id = number;
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
  readonly provenance: { readonly resultsSHA256: string; readonly sealSHA256: string; readonly sourceSHA256: string; readonly platform: string };
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

const ids: readonly Id[] = [1, 2, 3, 4];
const expectedDigests: readonly string[] = ["cadc1cfd70d6bcf97ce0b6bf9b59f03e77614e60845f397f77e5251e5b0abc6d","dce3406bab76922bc5f3f7fa19a6d4cb227a30123deb0ea70164b3d8789bc25a","2c5cc2f1b4e93e9227d4b6825a946f02d88e578aa9c305636620f0ce700402c4","1ead076a9f1a39394d744a6b54f020ddf0bda0961146d085bb5e921a1933cbf2"];
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
const fixture = () => readStatic(new URL("./foreground53-reference.json", import.meta.url), 1048576);
let compiled: string | undefined;

async function canonical(): Promise<Lookup> {
  return (await import("./foreground53-reference.js")).foregroundJobReference;
}

function mockFilesystem(fault: Fault, calls: Trace, reason: unknown, override?: Buffer, combined?: CombinedFault) {
  const bytes = Buffer.from(override ?? fixture());
  if (fault === "digest") bytes[0] = 32;
  const memory = createFsFromVolume(Volume.fromJSON({ "/foreground-fixture/foreground53-reference.json": bytes }));
  return {
    constants,
    lstatSync(url: URL) {
      calls.preflights++;
      if (fault === "preflight-failure") throw reason;
      const stat = memory.lstatSync(fileURLToPath(url));
      const sizes: Partial<Record<Fault, number>> = { "preflight-oversize": 1048577, "preflight-empty": 0, "preflight-negative-size": -1, "preflight-fractional-size": 1.5, "preflight-nan-size": NaN };
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
      assert.equal(fileURLToPath(url), "/foreground-fixture/foreground53-reference.json");
      if (fault === "open-failure") throw reason;
      return memory.openSync(fileURLToPath(url), flags);
    },
    fstatSync(descriptor: number) {
      calls.stats++;
      if (fault === "stat-failure") throw combined ? combined.primary : reason;
      const stat = memory.fstatSync(descriptor);
      const sizes: Partial<Record<Fault, number>> = { oversize: 1048577, empty: 0, "negative-size": -1, "fractional-size": 1.5, "nan-size": NaN };
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
    const source = readStatic(new URL("./foreground53-reference.ts", import.meta.url), 65536).toString();
    compiled = ts.transpileModule(source.replace("import.meta.url", JSON.stringify("file:///foreground-fixture/foreground53-reference.ts")), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
    }).outputText;
  }
  const filesystem = mockFilesystem(fault, calls, reason, override, combined);
  const exports: { foregroundJobReference?: Lookup } = {};
  runInNewContext(`const originalParse = JSON.parse; JSON.parse = (...args) => { noteParse(); return originalParse(...args); };\n${compiled}`, {
    exports, Buffer, URL, noteParse() { calls.parses++; },
    require(name: string) {
      if (name === "node:assert/strict") return assert;
      if (name === "node:crypto") return { createHash };
      if (name === "node:fs") return filesystem;
      throw new Error(`Unapproved foreground-reference import: ${name}`);
    },
  }, { timeout: 1000 });
  assert.equal(typeof exports.foregroundJobReference, "function");
  return exports.foregroundJobReference!;
}

for (const fault of ["preflight-not-file", "preflight-symlink", "preflight-oversize", "preflight-empty", "preflight-negative-size", "preflight-fractional-size", "preflight-nan-size", "preflight-failure"] as const) test(`static-reader ${fault} refuses before payload access`, () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///foreground-fixture/foreground53-reference.json"), 1048576, mockFilesystem(fault, calls, new Error(fault))));
  assert.equal(calls.preflights, 1);
  assert.equal(calls.opens, 0);
  assert.equal(calls.reads, 0);
  assert.equal(calls.closes, 0);
});

for (const fault of ["not-file", "oversize", "empty", "negative-size", "fractional-size", "nan-size", "acquisition-drift", "early-eof", "growth", "post-stat-drift", "oversized-count", "negative-count", "fractional-count", "nan-count"] as const) test(`static-reader ${fault} rejects held admission or read failure and closes once`, () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///foreground-fixture/foreground53-reference.json"), 1048576, mockFilesystem(fault, calls, new Error(fault))));
  assert.equal(calls.opens, 1);
  assert.equal(calls.closes, 1);
  if (["not-file", "oversize", "empty", "negative-size", "fractional-size", "nan-size", "acquisition-drift"].includes(fault)) assert.equal(calls.reads, 0);
});

for (const primary of [undefined, null, false, 0, ""]) test(`static-reader combined read/close preserves ${String(primary)}`, () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///foreground-fixture/foreground53-reference.json"), 1048576, mockFilesystem("read-failure", calls, undefined, undefined, { primary, cleanup: new Error("close failure") })), actual => Object.is(actual, primary));
  assert.equal(calls.opens, 1);
  assert.equal(calls.closes, 1);
});

for (const fault of ["none", "short"] as const) test(`static-reader ${fault} reads admitted bytes and closes once`, () => {
  const calls = trace();
  assert.deepEqual(readStatic(new URL("file:///foreground-fixture/foreground53-reference.json"), 1048576, mockFilesystem(fault, calls, undefined)), fixture());
  assert.equal(calls.preflights, 1);
  assert.equal(calls.opens, 1);
  assert.equal(calls.closes, 1);
  assert.equal(calls.stats, 2);
  assert.ok(calls.reads >= 2);
});

test("static source reader enforces its smaller bound before opening", () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///foreground-fixture/foreground53-reference.json"), 65536, mockFilesystem("none", calls, undefined)));
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
    assert.throws(() => readStatic(new URL("file:///foreground-fixture/foreground53-reference.json"), 1048576, mockFilesystem("close-failure", calls, cleanup)), actual => Object.is(actual, cleanup));
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
    : readStatic(new URL("file:///foreground-fixture/foreground53-reference.json"), 1048576, mockFilesystem("none", calls, undefined, undefined, combined)), actual => actual === cleanup);
  assert.equal(calls.closes, 1);
  assert.equal(calls.releases, 0);
  assert.equal(calls.parses, 0);
});

test("static-reader held stat plus close failure retains falsey primary", () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///foreground-fixture/foreground53-reference.json"), 1048576, mockFilesystem("stat-failure", calls, undefined, undefined, { primary: 0, cleanup: new Error("close failure") })), actual => actual === 0);
  assert.equal(calls.closes, 1);
  assert.equal(calls.reads, 0);
});

test("static-reader byte validation plus close failure preserves validation", () => {
  const calls = trace();
  assert.throws(() => readStatic(new URL("file:///foreground-fixture/foreground53-reference.json"), 1048576, mockFilesystem("early-eof", calls, undefined, undefined, { primary: undefined, cleanup: false })), { message: "Static input ended early or returned an invalid byte count" });
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
  assert.throws(() => evaluate("early-eof", calls, undefined, undefined, { primary: undefined, cleanup: false }), { message: "Foreground reference ended early or returned an invalid byte count" });
  assert.equal(calls.closes, 1);
  assert.equal(calls.parses, 0);
});

for (const [index, id] of ids.entries()) test(`native foreground observation ${id} retains exact request and raw effects`, async () => {
  const lookup = await canonical();
  const actual = lookup(id);
  assert.equal(actual.id, id);
  assert.equal(digest(JSON.stringify({ source: actual.source, stdinHex: actual.stdin.toString("hex"), stdoutHex: actual.stdout.toString("hex"), stderrHex: actual.stderr.toString("hex"), status: actual.status })), expectedDigests[index]);
  assert.deepEqual(actual.request.argv, ["--noprofile", "--norc", "-c", actual.source, "shell"]);
  assert.equal(actual.request.argv0, "shell");
  assert.equal(actual.request.sourceHex, Buffer.from(actual.source).toString("hex"));
  assert.equal(actual.request.stdinHex, "");
  assert.deepEqual(actual.request.environment, { LC_ALL: "C", PATH: "/__ordinary_jobs_no_external_commands__" });
  assert.deepEqual(actual.request.gates, []);
  assert.equal(actual.provenance.sourceSHA256, digest(actual.source));
  assert.equal(actual.provenance.platform, "darwin");
  assert.equal(actual.provenance.resultsSHA256, "14b1176ee7486c107d0a7a44494500b3c5e713b01a1cb9cc17f607b8a260e0f4");
  assert.equal(actual.provenance.sealSHA256, "cdc0c2d1052247fc3bcac1c303a428b728705c78a4d540180bbbad941ca9cc3b");
});

test("immutable foreground capsule preserves all artifact bytes and contains no executable TS or binaries", async () => {
  await canonical();
  const bytes = fixture();
  assert.equal(bytes.length, 432045);
  assert.equal(digest(bytes), "9b2ea50041ed6a3b944b1dd3d85694bb1fe6caf916d5ba17e9433ec71e453804");
  const data = JSON.parse(bytes.toString()) as { format: number; artifacts: Record<string, { path: string; bytes: number; contents: string; sha256: string }>; records: unknown[] };
  assert.equal(data.format, 1);
  assert.equal(data.records.length, 4);
  assert.equal(Object.keys(data.artifacts).length, 42);
  for (const [name, artifact] of Object.entries(data.artifacts)) {
    assert.equal(Buffer.byteLength(artifact.contents), artifact.bytes);
    assert.equal(digest(artifact.contents), artifact.sha256);
    assert.ok([".json", ".mjs", ".bash"].some(extension => name.endsWith(extension)));
    assert.equal(artifact.path.endsWith(".ts"), false);
  }
  assert.equal(data.artifacts["results.json"]?.sha256, "14b1176ee7486c107d0a7a44494500b3c5e713b01a1cb9cc17f607b8a260e0f4");
  assert.equal(data.artifacts["verified.json"]?.sha256, "19ba639fb6a5a529c4f6fef6e4d6eefa3da2760bf0ed0e4ceb043c29ce515721");
});

test("foreground qualification remains raw observation, not a universal state trace", async () => {
  const lookup = await canonical();
  for (const id of ids) {
    const actual = lookup(id);
    assert.equal(actual.qualification.kind, "observation");
    assert.equal(actual.qualification.deterministicGolden, false);
    assert.equal(actual.qualification.productReplay, false);
    assert.ok(actual.qualification.note.includes("not a universal"));
    assert.deepEqual(actual.sourceControl, Buffer.alloc(0));
  }
});

test("captured printed statuses differ from whole-subject success without normalization", async () => {
  const lookup = await canonical();
  assert.deepEqual(ids.map(id => lookup(id).stdout.toString()), ["status:127;set:\n", "status:7;set:x\n", "status:7;set:x\n", "status:7;set:x\n"]);
  for (const id of ids) {
    assert.equal(lookup(id).status, 0);
    assert.deepEqual(lookup(id).stderr, Buffer.alloc(0));
  }
});

test("exact request matching rejects unknown source, input and IDs", async () => {
  const lookup = await canonical();
  const actual = lookup(1);
  assert.equal(lookup(1, { source: actual.source, stdin: actual.stdin }).source, actual.source);
  assert.throws(() => lookup(1, { source: actual.source + " ", stdin: actual.stdin }));
  assert.throws(() => lookup(1, { source: actual.source, stdin: Buffer.from([0]) }));
  assert.throws(() => lookup(1, { source: actual.source, stdin: Buffer.alloc(65537) }));
  assert.throws(() => lookup(2, { source: actual.source, stdin: actual.stdin }));
  for (const id of [0, 5, -1, 1.5, NaN, Infinity, "1", "L1", "unknown"]) assert.throws(() => lookup(id as Id));
});

test("returned metadata is frozen and each payload buffer is caller-owned", async () => {
  const lookup = await canonical();
  const original = lookup(1);
  const changed = lookup(1);
  for (const name of ["stdin", "stdout", "stderr", "control", "sourceControl"] as const) {
    assert.notEqual(changed[name], original[name]);
    changed[name].fill(0);
    assert.deepEqual(lookup(1)[name], original[name]);
  }
  for (const value of [changed, changed.request, changed.request.argv, changed.request.environment, changed.request.gates, changed.qualification, changed.provenance]) assert.equal(Object.isFrozen(value), true);
  assert.equal(Reflect.set(changed.qualification, "deterministicGolden", true), false);
  assert.equal(Reflect.set(changed.request.argv, "3", ":"), false);
  assert.equal(lookup(1).qualification.deterministicGolden, false);
});

for (const fault of ["none", "short"] as const) test(`memfs ${fault} admission closes once without native or tmp reads`, async () => {
  await canonical();
  const calls = trace();
  const lookup = evaluate(fault, calls);
  assert.equal(lookup(1).qualification.kind, "observation");
  assert.equal(calls.preflights, 1);
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
  const data = JSON.parse(fixture().toString()) as { format: number; qualification: { deterministicGolden: boolean }; records: unknown[]; artifacts: Record<string, { contents: string }> };
  if (change === "schema") data.format = 2;
  else if (change === "qualification") data.qualification.deterministicGolden = true;
  else if (change === "missing-record") data.records.pop();
  else if (change === "missing-artifact") delete data.artifacts["capture.mjs"];
  else {
    const record = JSON.parse(data.artifacts["case-1-result.json"]!.contents) as Record<string, unknown>;
    record[change === "source" ? "source" : `${change}Hex`] = change === "source" ? ":" : "ff";
    data.artifacts["case-1-result.json"]!.contents = JSON.stringify(record);
  }
  const calls = trace();
  assert.throws(() => evaluate("none", calls, undefined, Buffer.from(JSON.stringify(data))));
  assert.equal(calls.closes, 1);
  assert.equal(calls.parses, 0);
});
