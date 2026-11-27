import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { chunks, emptyMember, helloMember, run } from "./test-helpers.js";

const header = "         compressed        uncompressed  ratio uncompressed_name\n";
const hello = "                 26                   6 -33.3% f\n";

for (const flag of ["-l", "--list", "-dl", "-lt"]) {
  test(`gzip ${flag} lists sizes without changing files`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/f.gz", helloMember);
    await fs.writeFile("/f", Buffer.from("keep"));
    const result = await run("gzip", [flag, "f.gz"], undefined, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.toString(), header + hello);
    assert.deepEqual(await fs.readFile("/f.gz"), new Uint8Array(helloMember));
    assert.equal(new TextDecoder().decode(await fs.readFile("/f")), "keep");
  });
}

test("gzip list handles fragmented stdin and suppresses headers with quiet", async () => {
  const result = await run("gzip", ["-ql"], chunks(...Array.from(helloMember, byte => Uint8Array.of(byte))));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), hello.replace(" f\n", " stdout\n"));
});

test("gzip list prints a single header and totals for multiple operands", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/f.gz", helloMember);
  await fs.writeFile("/empty.gz", emptyMember);
  const result = await run("gzip", ["-l", "f.gz", "empty.gz"], undefined, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), header + hello
    + "                 20                   0   0.0% empty\n"
    + "                 46                   6 -366.7% (totals)\n");
});

test("gzip list rejects invalid and truncated input while continuing other operands", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/invalid.gz", Buffer.from("not gzip"));
  await fs.writeFile("/short.gz", helloMember.subarray(0, 12));
  await fs.writeFile("/f.gz", helloMember);
  const result = await run("gzip", ["-l", "invalid.gz", "short.gz", "f.gz"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("not in gzip format"));
  assert.ok(result.stderr.includes("unexpected end of file"));
  assert.ok(result.stdout.toString().startsWith(header + hello));
  assert.deepEqual(await fs.readFile("/f.gz"), new Uint8Array(helloMember));
});

test("gzip list preserves operand spelling, suffix lookup, and custom suffixes", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/f.gz", helloMember);
  await fs.writeFile("/f.custom", helloMember);
  for (const [args, name] of [
    [["-l", "f"], "f"], [["-l", "./f.gz"], "./f"],
    [["-l", "/f.gz"], "/f"], [["-lS", ".custom", "f.custom"], "f"],
  ] as const) {
    const result = await run("gzip", args, undefined, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString(), header + hello.replace(" f\n", ` ${name}\n`));
  }
});

test("gzip list uses trailer metadata without inflating concatenated members", async () => {
  const result = await run("gzip", ["-l"], chunks(helloMember, emptyMember));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), header + "                 46                   0   0.0% stdout\n");
});

test("gzip list yields while scanning a large optional header and preserves cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("stop listing");
  const fixed = Buffer.from(helloMember.subarray(0, 10));
  fixed[3] = 16;
  const member = Buffer.concat([fixed, Buffer.alloc(64 * 1024, 65), Buffer.from([0]), helloMember.subarray(10)]);
  const pending = run("gzip", ["-l"], chunks(member), { signal: controller.signal });
  const rejected = assert.rejects(pending, error => error === reason);
  const task = setImmediate(() => controller.abort(reason));
  try { await rejected; } finally { clearImmediate(task); }
});
