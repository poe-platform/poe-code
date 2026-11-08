import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError, type ByteSource } from "../../../../src/contracts/index.js";
import { JqError } from "../../../../src/commands/structured/limits.js";
import { run, chunks } from "../../structured/helpers.js";

test("scalar delimiters do not consume the value byte budget", async () => {
  for (const input of ["0 ", "0\n", "0\t", "0\r"]) {
    const result = await run(["-c", "."], chunks(input), { limits: { maxValueBytes: 1 } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "0\n");
  }
});

test("incremental tokens preserve input, value, collection and step ceilings", async () => {
  for (const [input, limits, name] of [
    ["NaN123456", { maxInputBytes: 8 }, "maxInputBytes"],
    ["NaN123456", { maxValueBytes: 8 }, "maxValueBytes"],
    ["[NaN,Infinity,01]", { maxCollectionSize: 2 }, "maxCollectionSize"],
    ["[[[NaN]]]", { maxDepth: 2 }, "maxDepth"],
    ["1".repeat(65536), { maxSteps: 20 }, "maxSteps"],
  ] as const) {
    const result = await run(["-c", "."], chunks(input, 128), { limits });
    assert.equal(result.exitCode, 5);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp(name));
  }
});

test("nonfinite output budgets charge rendered bytes without changing truth", async () => {
  const exact = await run(["-ce", "."], "NaN", { limits: { maxOutputBytes: 5 } });
  assert.equal(exact.stdout, "null\n");
  assert.equal(exact.exitCode, 0);
  const short = await run(["-c", "."], "NaN", { limits: { maxOutputBytes: 4 } });
  assert.equal(short.stdout, "");
  assert.match(short.stderr, /maxOutputBytes/u);
});

test("fatal lexical errors close input without reading or emitting later records", async () => {
  let after = 0;
  let closed = 0;
  const source = (async function* () {
    try { yield Buffer.from("NaN\n[}\n"); after++; yield Buffer.from("Infinity\n"); }
    finally { closed++; }
  })();
  const result = await run(["-c", "."], source);
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "null\n");
  assert.equal(result.stderr, "jq: parse error: Unmatched '}' at line 2, column 2\n");
  assert.equal(after, 0);
  assert.equal(closed, 1);
});

for (const failure of [new FsError("EPIPE"), new FsError("EIO"), new Error("host stdout"), new JqError("host stdout jq error")]) test(`nonfinite serialization preserves stdout ${failure.message} identity and closes upstream`, async () => {
  let reads = 0;
  let writes = 0;
  let diagnostics = 0;
  let closed = 0;
  const source = (async function* () {
    try { reads++; yield Buffer.from("NaN\n"); reads++; yield Buffer.from("Infinity\n"); }
    finally { closed++; }
  })();
  await assert.rejects(run(["-c", "."], source, {}, {
    stdout: { async write() { writes++; throw failure; } },
    stderr: { async write() { diagnostics++; } },
  }), error => error === failure);
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  assert.equal(diagnostics, 0);
  assert.equal(closed, 1);
});

test("cancellation interrupts an unfinished numeric token and closes its source", async () => {
  const controller = new AbortController();
  const reason = new Error("owned lexical cancellation");
  let closed = 0;
  let reads = 0;
  const source: ByteSource = (async function* () {
    try { while (true) { reads++; yield Buffer.from("1".repeat(512)); } }
    finally { closed++; }
  })();
  const timer = setTimeout(() => controller.abort(reason), 5);
  try {
    await assert.rejects(run(["-c", "."], source, {}, { signal: controller.signal }), error => error === reason);
  } finally { clearTimeout(timer); }
  assert.ok(reads > 0);
  assert.equal(closed, 1);
});
