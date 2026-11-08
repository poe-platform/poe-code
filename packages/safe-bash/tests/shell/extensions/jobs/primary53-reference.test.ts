import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";
import { primaryJobReference } from "./primary53-reference.js";

const fixtureBytes = readFileSync(new URL("./primary53-reference.json", import.meta.url));
const loaderSource = readFileSync(new URL("./primary53-reference.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(loaderSource.replace("import.meta.url", JSON.stringify("file:///jobs-fixture/primary53-reference.ts")), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
}).outputText;

type Fault = "none" | "short" | "not-file" | "oversize" | "early-eof" | "growth" | "read-failure" | "open-failure" | "digest";
interface Trace { opens: number; reads: number; closes: number; flags?: number }

function evaluate(fault: Fault, trace: Trace) {
  const bytes = Buffer.from(fixtureBytes);
  if (fault === "digest") bytes[0] = 32;
  const memory = createFsFromVolume(Volume.fromJSON({ "/jobs-fixture/primary53-reference.json": bytes }));
  const filesystem = {
    constants,
    openSync(url: URL, flags: number) {
      trace.opens++;
      trace.flags = flags;
      if (fault === "open-failure") throw new Error("injected open failure");
      return memory.openSync(fileURLToPath(url), flags);
    },
    fstatSync(descriptor: number) {
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
  const exports: { primaryJobReference?: typeof primaryJobReference } = {};
  runInNewContext(compiled, {
    exports, Buffer, URL,
    require(name: string) {
      if (name === "node:assert/strict") return assert;
      if (name === "node:crypto") return { createHash };
      if (name === "node:fs") return filesystem;
      throw new Error(`Unapproved fixture-loader import: ${name}`);
    },
  }, { timeout: 1000 });
  assert.equal(typeof exports.primaryJobReference, "function");
  return exports.primaryJobReference!;
}

test("primary jobs helper returns exact bytes for all eighteen embedded subjects", () => {
  const reference = JSON.parse(fixtureBytes.toString()) as { records: { startup: { text: string }; result: { text: string } }[] };
  assert.equal(reference.records.length, 18);
  for (const entry of reference.records) {
    const startup = JSON.parse(entry.startup.text) as { entry: { name: string; gates?: number[] }; stdinHex: string };
    const result = JSON.parse(entry.result.text) as { id: number; source: string; subjectStatus: number; stdoutHex: string; stderrHex: string; identities: Record<string, number> };
    assert.deepEqual(primaryJobReference(result.id), {
      name: startup.entry.name, source: result.source, status: result.subjectStatus,
      stdin: Buffer.from(startup.stdinHex, "hex"), stdout: Buffer.from(result.stdoutHex, "hex"), stderr: Buffer.from(result.stderrHex, "hex"),
      requiresController: Boolean(startup.entry.gates?.length || Object.keys(result.identities).length),
    });
  }
});

test("primary jobs helper returns fresh input, output and diagnostic buffers", () => {
  for (const id of [5, 9, 14]) {
    const expected = primaryJobReference(id);
    const changed = primaryJobReference(id);
    changed.stdin.fill(0); changed.stdout.fill(0); changed.stderr.fill(0);
    changed.source = "mutated";
    assert.deepEqual(primaryJobReference(id), expected);
  }
});

test("primary jobs helper rejects missing and nonintegral identities", () => {
  for (const id of [0, -1, 19, 1.5, NaN, Infinity]) assert.throws(() => primaryJobReference(id), /Missing primary Bash 5\.3 jobs case/u);
});

for (const fault of ["none", "short"] as const) test(`primary jobs held descriptor closes after ${fault} reads`, () => {
  const trace: Trace = { opens: 0, reads: 0, closes: 0 };
  const lookup = evaluate(fault, trace);
  assert.deepEqual({ ...lookup(9) }, primaryJobReference(9));
  assert.equal(trace.opens, 1); assert.equal(trace.closes, 1);
  assert.equal(trace.flags, constants.O_RDONLY | constants.O_NOFOLLOW);
  assert.equal(trace.reads, fault === "short" ? Math.ceil(fixtureBytes.length / 4096) + 1 : 2);
});

for (const fault of ["not-file", "oversize", "early-eof", "growth", "read-failure", "digest"] as const) test(`primary jobs held descriptor rejects ${fault} and closes once`, () => {
  const trace: Trace = { opens: 0, reads: 0, closes: 0 };
  assert.throws(() => evaluate(fault, trace));
  assert.equal(trace.opens, 1); assert.equal(trace.closes, 1);
  assert.equal(trace.reads, fault === "not-file" || fault === "oversize" ? 0 : fault === "growth" || fault === "digest" ? 2 : 1);
});

test("primary jobs failed open does not attempt to close an unowned descriptor", () => {
  const trace: Trace = { opens: 0, reads: 0, closes: 0 };
  assert.throws(() => evaluate("open-failure", trace), /injected open failure/u);
  assert.equal(trace.opens, 1); assert.equal(trace.reads, 0); assert.equal(trace.closes, 0);
});
