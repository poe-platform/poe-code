import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";

interface ReferenceResult { name: string; source: string; status: number; stdin: Buffer; stdout: Buffer; stderr: Buffer }
type Lookup = (id: number) => ReferenceResult;
type Fault = "none" | "short" | "not-file" | "oversize" | "empty" | "negative-size" | "fractional-size" | "nan-size" | "infinite-size" | "early-eof" | "growth" | "stat-failure" | "read-failure" | "open-failure" | "close-failure" | "digest" | "valid-tamper" | "oversized-count" | "negative-count" | "fractional-count" | "nan-count" | "post-stat-drift";
interface Trace { opens: number; stats: number; reads: number; closes: number; parses: number; flags?: number }

const fixtureBytes = readFileSync(new URL("./negation-extended53-reference.json", import.meta.url));
const observations = [
  {
    "id": 1,
    "source": "! { true; } & wait \"$!\"; printf 'wait:%s\\n' \"$?\"",
    "stdout": "wait:0\n"
  },
  {
    "id": 2,
    "source": "! { false; } & wait \"$!\"; printf 'wait:%s\\n' \"$?\"",
    "stdout": "wait:1\n"
  },
  {
    "id": 3,
    "source": "! ( true ) & wait \"$!\"; printf 'wait:%s\\n' \"$?\"",
    "stdout": "wait:0\n"
  },
  {
    "id": 4,
    "source": "! ( false ) & wait \"$!\"; printf 'wait:%s\\n' \"$?\"",
    "stdout": "wait:1\n"
  },
  {
    "id": 5,
    "source": "set +o pipefail; ! false | true & wait \"$!\"; printf 'wait:%s\\n' \"$?\"",
    "stdout": "wait:0\n"
  },
  {
    "id": 6,
    "source": "set -o pipefail; ! false | true & wait \"$!\"; printf 'wait:%s\\n' \"$?\"",
    "stdout": "wait:1\n"
  },
  {
    "id": 7,
    "source": "set +o pipefail; ! true | false & wait \"$!\"; printf 'wait:%s\\n' \"$?\"",
    "stdout": "wait:1\n"
  },
  {
    "id": 8,
    "source": "worker() { return 7; }; ! worker & wait \"$!\"; printf 'wait:%s\\n' \"$?\"",
    "stdout": "wait:7\n"
  },
  {
    "id": 9,
    "source": "! exit 7 & wait \"$!\"; printf 'wait:%s\\n' \"$?\"",
    "stdout": "wait:7\n"
  },
  {
    "id": 10,
    "source": ": && ! { exit 7; } & wait \"$!\"; printf 'wait:%s\\n' \"$?\"",
    "stdout": "wait:7\n"
  }
];
let compiled: string | undefined;

function evaluate(fault: Fault, trace: Trace, reason: unknown = new Error(`injected ${fault}`)): Lookup {
  if (compiled === undefined) {
    const source = readFileSync(new URL("./negation-extended53-reference.ts", import.meta.url), "utf8");
    compiled = ts.transpileModule(source.replace("import.meta.url", JSON.stringify("file:///negation-fixture/negation-extended53-reference.ts")), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
    }).outputText;
  }
  let bytes = Buffer.from(fixtureBytes);
  if (fault === "digest") bytes[0] = 32;
  if (fault === "valid-tamper") {
    const altered = JSON.parse(bytes.toString()) as { classification: string };
    altered.classification = "tampered valid JSON";
    bytes = Buffer.from(JSON.stringify(altered));
  }
  const memory = createFsFromVolume(Volume.fromJSON({ "/negation-fixture/negation-extended53-reference.json": bytes }));
  const filesystem = {
    constants,
    openSync(url: URL, flags: number) {
      trace.opens++;
      trace.flags = flags;
      if (fault === "open-failure") throw reason;
      return memory.openSync(fileURLToPath(url), flags);
    },
    fstatSync(descriptor: number) {
      trace.stats++;
      if (fault === "stat-failure") throw reason;
      const stat = memory.fstatSync(descriptor);
      const sizes: Partial<Record<Fault, number>> = { oversize: 1048577, empty: 0, "negative-size": -1, "fractional-size": 1.5, "nan-size": NaN, "infinite-size": Infinity };
      return {
        size: sizes[fault] ?? Number(stat.size), dev: stat.dev, ino: stat.ino, mode: stat.mode,
        mtimeMs: Number(stat.mtimeMs) + (fault === "post-stat-drift" && trace.stats === 2 ? 1 : 0), ctimeMs: stat.ctimeMs,
        isFile: () => fault !== "not-file" && stat.isFile(),
      };
    },
    readSync(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
      trace.reads++;
      if (fault === "read-failure") throw reason;
      if (fault === "early-eof") return 0;
      if (fault === "growth" && position === bytes.length) { buffer[offset] = 32; return 1; }
      if (fault === "oversized-count") return length + 1;
      if (fault === "negative-count") return -1;
      if (fault === "fractional-count") return 0.5;
      if (fault === "nan-count") return NaN;
      return memory.readSync(descriptor, buffer, offset, fault === "short" ? Math.min(length, 4096) : length, position);
    },
    closeSync(descriptor: number) {
      trace.closes++;
      memory.closeSync(descriptor);
      if (fault === "close-failure") throw reason;
    },
  };
  const exports: { extendedNegationJobReference?: Lookup } = {};
  runInNewContext(`const originalParse = JSON.parse; JSON.parse = (...args) => { noteParse(); return originalParse(...args); };\n${compiled}`, {
    exports, Buffer, URL, noteParse() { trace.parses++; },
    require(name: string) {
      if (name === "node:assert/strict") return assert;
      if (name === "node:crypto") return { createHash };
      if (name === "node:fs") return filesystem;
      throw new Error(`Unapproved negation-loader import: ${name}`);
    },
  }, { timeout: 1000 });
  assert.equal(typeof exports.extendedNegationJobReference, "function");
  return exports.extendedNegationJobReference!;
}

for (const observation of observations) test(`extended negation reference ${observation.id} preserves exact measured program and bytes`, async () => {
  const { extendedNegationJobReference } = await import("./negation-extended53-reference.js");
  const actual = extendedNegationJobReference(observation.id);
  assert.equal(actual.source, observation.source);
  assert.equal(actual.status, 0);
  assert.deepEqual(actual.stdin, Buffer.alloc(0));
  assert.deepEqual(actual.stdout, Buffer.from(observation.stdout));
  assert.deepEqual(actual.stderr, Buffer.alloc(0));
});

test("extended negation reference authenticates all historical artifacts without asserting source predictions", () => {
  const fixture = JSON.parse(fixtureBytes.toString()) as { classification: string; profile: { platform: string; nodeVersion: string }; artifacts: Record<string, { sha256: string; contents: string }> };
  assert.ok(fixture.classification.includes("not asserted source predictions"));
  assert.equal(fixture.profile.platform, "darwin");
  assert.equal(fixture.profile.nodeVersion, "v22.23.2");
  assert.equal(Object.keys(fixture.artifacts).length, 58);
  for (const artifact of Object.values(fixture.artifacts)) assert.equal(createHash("sha256").update(artifact.contents).digest("hex"), artifact.sha256);
  assert.equal(fixture.artifacts["handoff.json"]?.sha256, "de64df34e8e1c8c8123030fcbcb93fcc7390f275cd49158886de4636688eec7e");
  assert.equal(fixture.artifacts["final.json"]?.sha256, "71afa0b102cbcb220d3c58de26afd2552609c2c0c575118f92319580506993a1");
});

test("extended negation references return fresh buffers and independent result objects", async () => {
  const { extendedNegationJobReference } = await import("./negation-extended53-reference.js");
  for (const { id } of observations) {
    const expected = extendedNegationJobReference(id);
    const changed = extendedNegationJobReference(id);
    for (const key of ["stdin", "stdout", "stderr"] as const) {
      assert.notEqual(changed[key], expected[key]);
      changed[key].fill(255);
    }
    changed.source = "changed";
    changed.status = 99;
    assert.deepEqual(extendedNegationJobReference(id), expected);
  }
});

test("extended negation reference refuses missing and nonintegral identities", async () => {
  const { extendedNegationJobReference } = await import("./negation-extended53-reference.js");
  for (const id of [0, 11, -1, 1.5, NaN, Infinity]) assert.throws(() => extendedNegationJobReference(id));
});

for (const fault of ["none", "short"] as const) test(`extended negation held descriptor: ${fault} reads authenticate and close once`, () => {
  const trace: Trace = { opens: 0, stats: 0, reads: 0, closes: 0, parses: 0 };
  const lookup = evaluate(fault, trace);
  for (const observation of observations) {
    assert.equal(lookup(observation.id).source, observation.source);
    assert.deepEqual(lookup(observation.id).stdout, Buffer.from(observation.stdout));
  }
  assert.equal(trace.opens, 1);
  assert.equal(trace.stats, 2);
  assert.equal(trace.closes, 1);
  assert.equal(trace.flags, constants.O_RDONLY | constants.O_NOFOLLOW);
  assert.equal(trace.reads, fault === "short" ? Math.ceil(fixtureBytes.length / 4096) + 1 : 2);
  assert.ok(trace.parses > 0);
});

for (const fault of ["not-file", "oversize", "empty", "negative-size", "fractional-size", "nan-size", "infinite-size", "stat-failure", "early-eof", "growth", "read-failure", "digest", "valid-tamper", "oversized-count", "negative-count", "fractional-count", "nan-count", "post-stat-drift"] as const) {
  test(`extended negation held descriptor: ${fault} refuses before JSON parsing and closes once`, () => {
    const trace: Trace = { opens: 0, stats: 0, reads: 0, closes: 0, parses: 0 };
    assert.throws(() => evaluate(fault, trace));
    assert.equal(trace.opens, 1);
    assert.equal(trace.closes, 1);
    assert.equal(trace.parses, 0);
    assert.equal(trace.flags, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (["not-file", "oversize", "empty", "negative-size", "fractional-size", "nan-size", "infinite-size", "stat-failure"].includes(fault)) assert.equal(trace.reads, 0);
  });
}

for (const reason of [false, 0, null]) test(`extended negation read failure preserves ${String(reason)} while closing the owned descriptor`, () => {
  const trace: Trace = { opens: 0, stats: 0, reads: 0, closes: 0, parses: 0 };
  let caught = false;
  try { evaluate("read-failure", trace, reason); }
  catch (error) { caught = true; assert.equal(error, reason); }
  assert.equal(caught, true);
  assert.equal(trace.closes, 1);
  assert.equal(trace.parses, 0);
});

test("extended negation failed open never closes an unowned descriptor", () => {
  const trace: Trace = { opens: 0, stats: 0, reads: 0, closes: 0, parses: 0 };
  const reason = new Error("open failed");
  assert.throws(() => evaluate("open-failure", trace, reason), error => error === reason);
  assert.deepEqual(trace, { opens: 1, stats: 0, reads: 0, closes: 0, parses: 0, flags: constants.O_RDONLY | constants.O_NOFOLLOW });
});

test("extended negation failed close refuses lookup before JSON parsing", () => {
  const trace: Trace = { opens: 0, stats: 0, reads: 0, closes: 0, parses: 0 };
  const reason = new Error("close failed");
  assert.throws(() => evaluate("close-failure", trace, reason), error => error === reason);
  assert.equal(trace.closes, 1);
  assert.equal(trace.parses, 0);
});
