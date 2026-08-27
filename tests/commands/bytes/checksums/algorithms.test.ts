import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chunks, fixture, run } from "./helpers.js";

const native = JSON.parse(await readFile(new URL("algorithms-native.json", import.meta.url), "utf8")) as { rows: { args: string[]; stdin: string; files: Record<string, string>; stdout: string; stderr: string; exitCode: number }[] };
for (const row of native.rows) test(`cksum GNU9.7 algorithm bytes: ${row.args.join(" ")}`, async () => {
  for (const width of [1, 7, 65536]) {
    const fs = await fixture(Object.fromEntries(Object.entries(row.files).map(([path, bytes]) => [path, Buffer.from(bytes, "base64")])));
    const result = await run("cksum", row.args, { fs, stdin: chunks(Buffer.from(row.stdin, "base64"), width) });
    assert.equal(Buffer.from(result.stdout).toString("base64"), row.stdout); assert.equal(Buffer.from(result.stderr).toString("base64"), row.stderr); assert.equal(result.exitCode, row.exitCode);
  }
});

test("cksum algorithm errors happen before input effects", async () => {
  let reads = 0;
  const stdin = (async function* () { reads++; yield new Uint8Array([1]); })();
  assert.notEqual((await run("cksum", ["-a", "imaginary"], { stdin })).exitCode, 0);
  assert.equal(reads, 0);
  assert.notEqual((await run("cksum", ["-a", "sha256", "--check"], { stdin })).exitCode, 0);
  assert.equal(reads, 0);
});

test("cksum selected algorithms retain blocked-input cancellation", async () => {
  const controller = new AbortController();
  const stdin = (async function* () { await new Promise<void>(() => {}); yield new Uint8Array(); })();
  const rejected = assert.rejects(run("cksum", ["-a", "sha512"], { stdin, signal: controller.signal }), /cancel hash/);
  controller.abort(new Error("cancel hash")); await rejected;
});
