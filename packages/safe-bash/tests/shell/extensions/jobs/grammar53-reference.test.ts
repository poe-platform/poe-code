import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";
import { grammarJobReference } from "./grammar53-reference.js";

const fixtureBytes = readFileSync(new URL("./grammar53-reference.json", import.meta.url));
const loaderSource = readFileSync(new URL("./grammar53-reference.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(loaderSource.replace("import.meta.url", JSON.stringify("file:///grammar-fixture/grammar53-reference.ts")), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
}).outputText;

type Fault = "none" | "short" | "not-file" | "oversize" | "early-eof" | "growth" | "stat-failure" | "read-failure" | "open-failure" | "digest";
interface Trace { opens: number; reads: number; closes: number; flags?: number }

function evaluate(fault: Fault, trace: Trace) {
  const bytes = Buffer.from(fixtureBytes);
  if (fault === "digest") bytes[0] = 32;
  const memory = createFsFromVolume(Volume.fromJSON({ "/grammar-fixture/grammar53-reference.json": bytes }));
  const filesystem = {
    constants,
    openSync(url: URL, flags: number) {
      trace.opens++;
      trace.flags = flags;
      if (fault === "open-failure") throw new Error("injected open failure");
      return memory.openSync(fileURLToPath(url), flags);
    },
    fstatSync(descriptor: number) {
      if (fault === "stat-failure") throw new Error("injected stat failure");
      const stat = memory.fstatSync(descriptor);
      return { size: fault === "oversize" ? 1048577 : Number(stat.size), isFile: () => fault !== "not-file" && stat.isFile() };
    },
    readSync(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
      trace.reads++;
      if (fault === "read-failure") throw new Error("injected read failure");
      if (fault === "early-eof") return 0;
      if (fault === "growth" && position === bytes.length) { buffer[offset] = 32; return 1; }
      return memory.readSync(descriptor, buffer, offset, fault === "short" ? Math.min(length, 4096) : length, position);
    },
    closeSync(descriptor: number) { trace.closes++; memory.closeSync(descriptor); },
  };
  const exports: { grammarJobReference?: typeof grammarJobReference } = {};
  runInNewContext(compiled, {
    exports, Buffer, URL,
    require(name: string) {
      if (name === "node:assert/strict") return assert;
      if (name === "node:crypto") return { createHash };
      if (name === "node:fs") return filesystem;
      throw new Error(`Unapproved grammar-loader import: ${name}`);
    },
  }, { timeout: 1000 });
  assert.equal(typeof exports.grammarJobReference, "function");
  return exports.grammarJobReference!;
}

test("grammar reference preserves all eight observations, including mixed options", () => {
  const fixture = JSON.parse(fixtureBytes.toString()) as { handoff: { text: string } };
  const handoff = JSON.parse(fixture.handoff.text) as { cases: { id: number; source: string; subjectStatus: number; stdoutHex: string; stderrHex: string; stdinHex: string }[] };
  assert.equal(handoff.cases.length, 8);
  for (const entry of handoff.cases) {
    const actual = grammarJobReference(entry.id);
    assert.equal(actual.source, entry.source);
    assert.equal(actual.status, entry.subjectStatus);
    assert.deepEqual(actual.stdin, Buffer.from(entry.stdinHex, "hex"));
    assert.deepEqual(actual.stdout, Buffer.from(entry.stdoutHex, "hex"));
    assert.deepEqual(actual.stderr, Buffer.from(entry.stderrHex, "hex"));
  }
});

test("grammar reference returns fresh buffers and refuses unavailable identities", () => {
  for (let id = 1; id <= 8; id++) {
    const expected = grammarJobReference(id);
    const changed = grammarJobReference(id);
    changed.stdin.fill(0); changed.stdout.fill(0); changed.stderr.fill(0);
    changed.source = "mutated";
    assert.deepEqual(grammarJobReference(id), expected);
    assert.notEqual(grammarJobReference(id).stdin, changed.stdin);
  }
  for (const id of [0, 9, -1, 1.5, NaN, Infinity]) assert.throws(() => grammarJobReference(id));
});

for (const fault of ["none", "short"] as const) test(`grammar held descriptor: ${fault} reads close once`, () => {
  const trace: Trace = { opens: 0, reads: 0, closes: 0 };
  const lookup = evaluate(fault, trace);
  assert.deepEqual({ ...lookup(8) }, grammarJobReference(8));
  assert.equal(trace.opens, 1);
  assert.equal(trace.closes, 1);
  assert.equal(trace.flags, constants.O_RDONLY | constants.O_NOFOLLOW);
  assert.equal(trace.reads, fault === "short" ? Math.ceil(fixtureBytes.length / 4096) + 1 : 2);
});

for (const fault of ["not-file", "oversize", "early-eof", "growth", "stat-failure", "read-failure", "digest"] as const) {
  test(`grammar held descriptor: ${fault} refuses admission and closes once`, () => {
    const trace: Trace = { opens: 0, reads: 0, closes: 0 };
    assert.throws(() => evaluate(fault, trace));
    assert.equal(trace.opens, 1);
    assert.equal(trace.closes, 1);
    if (fault === "not-file" || fault === "oversize" || fault === "stat-failure") assert.equal(trace.reads, 0);
  });
}

test("grammar failed open never closes an unowned descriptor", () => {
  const trace: Trace = { opens: 0, reads: 0, closes: 0 };
  assert.throws(() => evaluate("open-failure", trace));
  assert.deepEqual(trace, { opens: 1, reads: 0, closes: 0, flags: constants.O_RDONLY | constants.O_NOFOLLOW });
});
