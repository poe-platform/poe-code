import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createRevCommand } from "./index.js";

const cases = [
  { name: "reported two-line input", inputs: ["abc\ndef\n"], expected: "cba\nfed\n" },
  { name: "successive input chunks", inputs: ["abc\n", "def\n", "ghi"], expected: "cba\nfed\nihg" },
  {
    name: "multiple output buffer flushes",
    inputs: ["abc\n" + "defgh\n".repeat(6000) + "ijk"],
    expected: "cba\n" + "hgfed\n".repeat(6000) + "kji",
  },
  { name: "UTF-8 records", inputs: ["aé🙂\n", "bø界\n"], expected: "🙂éa\n界øb\n", locale: "C.UTF-8" },
  { name: "bounded output chunks", inputs: ["abc\n", "def\n"], expected: "cba\nfed\n", maxChunkBytes: 4 },
];

for (const fixture of cases) {
  test(`rev preserves retained stdout bytes for ${fixture.name}`, async () => {
    const values = createCommandArguments([]);
    const chunks: Uint8Array[] = [];
    const snapshots: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createRevCommand({
      limits: { maxChunkBytes: fixture.maxChunkBytes ?? Infinity },
    }).execute({
      command: "rev", args: values.args, argumentValues: values, cwd: "/",
      env: { LC_ALL: fixture.locale ?? "C" },
      fs: createMemoryFileSystem(),
      stdin: { async *[Symbol.asyncIterator]() {
        for (const input of fixture.inputs) yield new TextEncoder().encode(input);
      } },
      stdout: { async write(bytes) { chunks.push(bytes); snapshots.push(bytes.slice()); } },
      stderr: { async write(bytes) { errors.push(bytes.slice()); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(chunks, snapshots, "previously emitted chunks must remain unchanged");
    assert.equal(Buffer.concat(chunks).toString("utf8"), fixture.expected);
    if (fixture.name === "multiple output buffer flushes") assert.ok(chunks.length > 1);
    if (fixture.maxChunkBytes) assert.ok(chunks.every(chunk => chunk.length <= fixture.maxChunkBytes!));
  });
}
