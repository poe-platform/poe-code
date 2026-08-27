import assert from "node:assert/strict";
import test from "node:test";
import { createColumnCommand, type ColumnLimits } from "../../../src/commands/column/index.js";
import { type ByteSource } from "../../../src/contracts/index.js";
import { run } from "./helpers.js";

for (const args of [["--json"], ["--tree", "1"], ["-N", "heading"], ["-S", "2"], ["-c0"], ["-c", "unlimited"], ["-c", "1e3"], ["-c", "-3"], ["-c", "999999999999999999999"], ["-c"], ["-s"], ["-t", "-s", ""], ["-o", "|"], ["-s:"], ["-tx"], ["--table=yes"]]) {
  test(`unsupported/invalid argv ${JSON.stringify(args)}`, async () => {
    let acquired = false;
    const result = await run(args, "", {}, { stdin: { [Symbol.asyncIterator]() { acquired = true; throw new Error("unexpected acquisition"); } } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.length);
    assert.equal(acquired, false);
  });
}

for (const bytes of [Buffer.from([0xc0, 0xaf, 10]), Buffer.from([0xe2, 0x82]), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from([0xf4, 0x90, 0x80, 0x80]), Buffer.from([0xff])]) {
  test(`invalid UTF-8 rejects ${bytes.toString("hex")}`, async () => {
    const result = await run(["-t"], bytes);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /invalid UTF-8/);
  });
}

for (const text of ["\0", "\x1b[31mred", "\x7f", "\u0085", "\u200d", "\u202e", "\ufeff"]) {
  test(`controls reject ${JSON.stringify(text)}`, async () => {
    const result = await run(["-t"], `ok x\n${text} y\n`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /unsupported control/);
  });
}

for (const args of [["-t", "-o\n"], ["-t", "-o\t"], ["-t", "-s\0"], ["-t", "-s\ud800"], ["-t", "-o\udfff"]]) {
  test(`unsafe separator rejects ${JSON.stringify(args)}`, async () => {
    assert.equal((await run(args, "a b\n")).exitCode, 1);
  });
}

test("table ASCII delimiter controls are consumed, not emitted", async () => {
  assert.equal((await run(["-t"], "a\vb\rc\fd\n")).stdout, "a  b  c  d\n");
  assert.equal((await run([], "a\rb\n")).exitCode, 1);
});

const cases: { name: keyof ColumnLimits; maximum: number; input: string; args?: string[]; label: string }[] = [
  { name: "maxInputBytes", maximum: 3, input: "a b\n", label: "input" },
  { name: "maxChunkBytes", maximum: 3, input: "a b\n", label: "chunk" },
  { name: "maxRecordBytes", maximum: 2, input: "a b\n", label: "record" },
  { name: "maxRows", maximum: 2, input: "\n\n\n", label: "rows" },
  { name: "maxCells", maximum: 3, input: "a b\nc d\n", label: "cells" },
  { name: "maxFields", maximum: 2, input: "a b c\n", label: "fields" },
  { name: "maxSteps", maximum: 10, input: "abcdef ghijkl\n", label: "work" },
  { name: "maxOutputBytes", maximum: 3, input: "aa\nlong b\n", label: "output" },
  { name: "maxWidth", maximum: 2, input: "界a b\n", label: "width" },
  { name: "maxFiles", maximum: 1, input: "a b\n", args: ["-t", "-", "-"], label: "file" },
  { name: "maxArgumentBytes", maximum: 2, input: "", args: ["-t", "--"], label: "argument" },
];
for (const fixture of cases) test(`cumulative/structural ${fixture.name}`, async () => {
  const result = await run(fixture.args ?? ["-t"], fixture.input, { limits: { [fixture.name]: fixture.maximum } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, new RegExp(fixture.label));
  assert.ok(result.stdoutBytes.length <= (fixture.name === "maxOutputBytes" ? fixture.maximum : 1024));
});

test("cumulative input/rows/cells limits span multiple file operands", async () => {
  const { context } = await run();
  await context.fs.writeFile("/one", Buffer.from("a b\n"));
  await context.fs.writeFile("/two", Buffer.from("c d\n"));
  for (const limits of [{ maxInputBytes: 7 }, { maxRows: 1 }, { maxCells: 3 }]) {
    const result = await run(["-t", "/one", "/two"], "", { limits }, { fs: context.fs });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
  }
});

test("padding is checked before allocation and cumulative work charges expansion", async () => {
  const result = await run(["-t"], `a x\n${"b".repeat(1000)} y\n`, { limits: { maxOutputBytes: 3 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "a");
  assert.match(result.stderr, /output padding limit/);
});

test("output byte limit counts multibyte UTF-8, not UTF-16 length", async () => {
  const result = await run(["-t"], "界\n", { limits: { maxOutputBytes: 2 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
});

test("exact limit boundaries succeed", async () => {
  const result = await run(["-t"], "a b\n", { limits: { maxInputBytes: 4, maxChunkBytes: 4, maxRecordBytes: 3, maxRows: 1, maxCells: 2, maxFields: 2, maxOutputBytes: 5, maxWidth: 1 } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "a  b\n");
});

test("empty chunks are bounded by shared work budget", async () => {
  let returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: new Uint8Array() }; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  const result = await run(["-t"], "", { limits: { maxSteps: 20 } }, { stdin });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /work/);
  assert.equal(returned, 1);
});

test("option limits reject nonsafe, zero, fractional and huge allocations", () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 67_108_865]) {
    assert.throws(() => createColumnCommand({ limits: { maxRows: value } }), RangeError);
  }
});

test("help documents real supported behavior without acquiring input", async () => {
  const result = await run(["--help"], "", {}, { stdin: { [Symbol.asyncIterator]() { throw new Error("acquired"); } } });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /--table/);
  assert.match(result.stdout, /Strict UTF-8/);
});

test("diagnostic bytes are bounded cumulatively, independently of stdout", async () => {
  const result = await run(["-t", "/missing-one", "/missing-two", "/missing-three"], "", { limits: { maxDiagnosticBytes: 120 } });
  assert.equal(result.exitCode, 1);
  assert.ok(Buffer.byteLength(result.stderr) <= 120);
  assert.match(result.stderr, /missing-one/);
});

test("large host error messages are truncated within the diagnostic bound", async () => {
  const stdin: ByteSource = (async function* () { throw new Error("界".repeat(100_000)); yield new Uint8Array(); })();
  const result = await run(["-t"], "", { limits: { maxDiagnosticBytes: 50 } }, { stdin });
  assert.equal(result.exitCode, 1);
  assert.ok(Buffer.byteLength(result.stderr) <= 50);
  assert.match(result.stderr, /diagnostic truncated/);
  assert.doesNotMatch(result.stderr, /\ufffd/);
});
