import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createColumnCommand } from "../../../../src/commands/column/index.ts";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.ts";
import { toByteSource } from "../../../../src/contracts/index.ts";

const mode = process.argv[2];
assert.ok(["empty", "combining", "explicit", "output-admission", "work-admission"].includes(mode));
const columns = 20_000, rows = 20_000;
const admission = mode.endsWith("admission");
const entry = mode === "combining" ? "\u0301" : "";
const dense = admission ? Array(columns).fill("a").join(":") : Array(columns).fill(entry).join(":");
const sparse = mode === "explicit" ? ":" : mode === "combining" ? "\u0301" : "x";
const input = admission ? `x\n${dense}\n${"x\n".repeat(rows - 1)}` : `${dense}\n${`${sparse}\n`.repeat(rows)}`;
const limits = {
  maxFields: columns, maxRows: rows + 1, maxCells: columns + rows * 2,
  maxSteps: 1_000_000, maxOutputBytes: admission ? mode === "output-admission" ? 32 : 1_000_000 : 200_000,
};
if (mode === "work-admission") limits.maxSteps = 360_000;
const digest = createHash("sha256");
let outputBytes = 0, writes = 0, maximumChunk = 0, armed = false, oversizedAllocations = 0;
const originalRepeat = String.prototype.repeat;
const originalArray = globalThis.Uint8Array;
String.prototype.repeat = function(count) {
  if (armed && count > 8192) { oversizedAllocations++; throw new Error("oversized padding repeat after output admission"); }
  return originalRepeat.call(this, count);
};
globalThis.Uint8Array = new Proxy(originalArray, { construct(target, args, newTarget) {
  if (armed && typeof args[0] === "number" && args[0] > 8192) { oversizedAllocations++; throw new Error("oversized padding allocation after output admission"); }
  return Reflect.construct(target, args, newTarget);
} });
const stderr = [];
let result;
try {
  result = await createColumnCommand({ limits }).execute({
    command: "column", args: ["-t", "-s:", "-o", admission ? " ".repeat(10) : ""],
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(input),
    stdout: { async write(bytes) { armed = true; outputBytes += bytes.length; writes++; maximumChunk = Math.max(maximumChunk, bytes.length); digest.update(bytes); } },
    stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
  });
} finally {
  String.prototype.repeat = originalRepeat;
  globalThis.Uint8Array = originalArray;
}
const actualHash = digest.digest("hex"), diagnostic = Buffer.concat(stderr).toString();
assert.equal(oversizedAllocations, 0);
assert.ok(maximumChunk <= 8192);
if (admission) {
  assert.equal(result.exitCode, 1);
  assert.equal(outputBytes, 1);
  assert.equal(actualHash, createHash("sha256").update("x").digest("hex"));
  assert.match(diagnostic, mode === "output-admission" ? /output padding limit/ : /work limit/);
} else {
  const expected = mode === "combining" ? `${entry.repeat(columns)}\n${`${entry}\n`.repeat(rows)}`
    : mode === "explicit" ? "\n".repeat(rows + 1) : ` \n${"x\n".repeat(rows)}`;
  assert.equal(result.exitCode, 0);
  assert.equal(diagnostic, "");
  assert.equal(outputBytes, Buffer.byteLength(expected));
  assert.equal(actualHash, createHash("sha256").update(expected).digest("hex"));
}
console.log(JSON.stringify({ mode, columns, sparseRows: rows, retainedRows: rows + 1, conceptualRectangle: columns * (rows + 1), actualInputBytes: Buffer.byteLength(input), outputBytes, writes, maximumChunk, oversizedAllocations, exitCode: result.exitCode, diagnostic, outputSha256: actualHash, limits, memory: process.memoryUsage() }));
