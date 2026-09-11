import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { textProgramCommands, type TextProgramOptions } from "../../../src/commands/text-programs/index.js";

const originalPadStart = String.prototype.padStart;

async function run(program: string, options: TextProgramOptions = {}) {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(textProgramCommands({ maxBufferBytes: 512, ...options }));
  try { return await shell.exec(`awk '${program}'`); }
  finally { await shell.dispose(); }
}

const repeated = JSON.stringify("%%".repeat(128));
for (const [route, program] of [
  ["printf", `BEGIN { printf ${repeated} }`],
  ["sprintf", `BEGIN { value=sprintf(${repeated}) }`],
  ["CONVFMT concatenation", `BEGIN { CONVFMT=${repeated}; value=1.5 "" }`],
  ["CONVFMT comparison", `BEGIN { CONVFMT=${repeated}; value=(1.5 == "x") }`],
  ["numeric CONVFMT value", 'BEGIN { CONVFMT=1.5; value=1 "" }'],
] as const) {
  test(`awk ${route} admits format scanning against the existing work budget`, async () => {
    const result = await run(program, { maxSteps: 16 });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /execution step limit exceeded/u);
    assert.equal(result.stdout, "");
  });
}

for (const [route, program] of [
  ["printf", 'BEGIN { printf "%128s", "x" }'],
  ["sprintf", 'BEGIN { value=sprintf("%128s", "x") }'],
  ["OFMT", 'BEGIN { OFMT="%128g"; print 1.5 }'],
  ["CONVFMT", 'BEGIN { CONVFMT="%128g"; value=1.5 "" }'],
  ["comparison", 'BEGIN { CONVFMT="%128g"; value=(1.5 == "x") }'],
] as const) {
  for (const boundary of ["work", "buffer"] as const) {
    test(`awk ${route} admits ${boundary} before padding materialization`, async context => {
      const original = String.prototype.padStart;
      let padded = 0;
      String.prototype.padStart = function (this: string, maximum: number, fill?: string) {
        if (maximum === 128) padded++;
        return original.call(this, maximum, fill);
      };
      context.after(() => { String.prototype.padStart = original; });
      const result = await run(program, boundary === "work" ? { maxSteps: 32 } : { maxBufferBytes: 64 });
      assert.equal(result.exitCode, 2);
      assert.match(result.stderr, boundary === "work" ? /execution step limit exceeded/u : /buffer limit/u);
      assert.equal(result.stdout, "");
      assert.equal(padded, 0, "rejected padding must not be materialized");
      assert.equal("x".padStart(128).length, 128);
      assert.equal(padded, 1, "the observer must recognize actual padding");
    });
  }
}

test("awk formatting retains exact bytes, flags, dynamic width and precision", async () => {
  const result = await run('BEGIN { printf "%+06d|%-5.2s|%#x|%*.*f|%%", -12, "abcd", 31, 7, 2, 1.25 }');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "-00012|ab   |0x1f|   1.25|%");
});

test("awk character formatting preserves raw byte identity", async () => {
  const result = await run('BEGIN { printf "%c%c%c", 0, 255, 128 }');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(0, 255, 128));
});

test("awk formatted output accepts the exact configured buffer size", async () => {
  const result = await run('BEGIN { printf "%64s", "x" }', { maxBufferBytes: 64 });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, " ".repeat(63) + "x");
});

test("awk evaluates all format arguments before formatting and before redirect expressions", async () => {
  const result = await run('function mark(v) { printf "%s", v; return v } BEGIN { printf "%s", mark("a"), mark("b") > mark("out") }');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "about");
});

test("awk rejected format work retains argument effects but does not evaluate the redirect", async () => {
  const result = await run('function mark(v) { printf "%s", v; return v } BEGIN { printf "%128s", mark("a"), mark("b") > mark("out") }', { maxSteps: 64 });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /execution step limit exceeded/u);
  assert.equal(result.stdout, "ab");
});

test("awk implicit formatting preserves numeric and no-argument print fast paths", async () => {
  const result = await run('BEGIN { OFMT="%bad"; CONVFMT="%bad"; print 12; value=12 ""; print value; print (1.5 == 1.5); $0="raw"; OFS=1.5; print }');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "12\n12\n1\nraw\n");
});

test("awk conversions observe format assignments in later evaluated arguments", async () => {
  const result = await run('BEGIN { print 1.5, (OFMT="%.2f"); printf "%s|%s", 1.5, (CONVFMT="%.3f"); printf "|%s", sprintf("%s", 1.5) }');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "1.50 %.2f\n1.500|%.3f|1.500");
});

for (const [program, error] of [
  ['BEGIN { value=sprintf("%s") }', /not enough arguments/u],
  ['BEGIN { value=sprintf("%q", 1) }', /unsupported format/u],
  ['BEGIN { value=sprintf("%1000001s", "x") }', /excessive format width or precision/u],
] as const) {
  test(`awk preserves format diagnostics under an ample budget: ${program}`, async () => {
    const result = await run(program);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, error);
    assert.equal(result.stdout, "");
  });
}

test("awk formatting observers restore the original padding method", () => {
  assert.equal(String.prototype.padStart, originalPadStart);
});
