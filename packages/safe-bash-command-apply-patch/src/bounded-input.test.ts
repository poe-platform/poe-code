import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createApplyPatchCommand } from "./index.js";
import { Work } from "./shared.js";

for (const ending of ["\n", "\r\n"]) test(`patch input retains long payload lines in caller storage: ${JSON.stringify(ending)}`, async t => {
  const fs = createMemoryFileSystem();
  const encoder = new TextEncoder();
  const block = new Uint8Array(16384).fill(120);
  t.mock.method(Work.prototype, "text", async function(bytes: Uint8Array) {
    assert.ok(bytes.length <= 16384, "whole patch decoding is forbidden");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  });
  let opens = 0;
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => { opens++; return open(...args); });
  const decode = TextDecoder.prototype.decode;
  t.mock.method(TextDecoder.prototype, "decode", function(this: TextDecoder, ...args: Parameters<typeof decode>) {
    assert.ok((args[0]?.byteLength ?? 0) <= 16384, "decoding must use bounded chunks");
    return decode.apply(this, args);
  });
  let error = "";
  const run = async (update: boolean) => createApplyPatchCommand().execute({
    command: "apply_patch", args: [], cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {
      yield encoder.encode(`*** Begin Patch${ending}*** ${update ? "Update" : "Add"} File: /file${ending}${update ? `@@${ending}-` : "+"}`);
      for (let index = 0; index < 32; index++) { block.fill(120); yield block; }
      assert.ok(opens > 0, "patch input must spill before its producer finishes");
      block.fill(121);
      yield encoder.encode(`${ending}${update ? `+done${ending}` : ""}*** End Patch${ending}`);
    } },
    stdout: { async write(bytes) { assert.ok(bytes.length <= 16384); await Promise.resolve(); } },
    stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } },
  });
  assert.equal((await run(false)).exitCode, 0, error);
  const bytes = await fs.readFile("/file");
  assert.equal(bytes.length, 32 * 16384 + 1);
  assert.ok(bytes.subarray(0, -1).every(byte => byte === 120));
  assert.equal((await run(true)).exitCode, 0, error);
  assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "done\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["file"]);
});

for (const failure of ["source", "cancel"] as const) test(`patch staging cleans up before mutation on ${failure}`, async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  await fs.writeFile("/file", new TextEncoder().encode("unchanged\n"));
  const block = new Uint8Array(16384).fill(120);
  const result = Promise.resolve(createApplyPatchCommand().execute({
    command: "apply_patch", args: [], cwd: "/", env: {}, fs, signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode("*** Begin Patch\n*** Update File: /file\n@@\n+");
      for (let index = 0; index < 32; index++) yield block;
      const error = new Error("patch source failed");
      if (failure === "cancel") controller.abort(error);
      throw error;
    } },
    stdout: { async write() { assert.fail("must not publish success"); } }, stderr: { async write() {} },
  }));
  await assert.rejects(result, /patch source failed/u);
  assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "unchanged\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["file"]);
});

test("literal patch arguments preserve surrogate pairs at encoding boundaries", async () => {
  const fs = createMemoryFileSystem();
  const prefix = "*** Begin Patch\n*** Add File: /file\n+";
  const value = "x".repeat(4095 - prefix.length) + "😀";
  let error = "";
  const result = await createApplyPatchCommand().execute({
    command: "apply_patch", args: [prefix + value + "\n*** End Patch"], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: { [Symbol.asyncIterator]() { assert.fail("literal input must not read stdin"); } },
    stdout: { async write() {} }, stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 0, error);
  assert.equal(new TextDecoder().decode(await fs.readFile("/file")), value + "\n");
});

for (const [bytes, message] of [[new Uint8Array([255]), "invalid UTF-8"], [new Uint8Array([255, 0]), "NUL bytes are unsupported"]] as const) {
  test(`staged input validates bytes before parsing: ${message}`, async () => {
    const fs = createMemoryFileSystem();
    let error = "";
    const result = await createApplyPatchCommand().execute({
      command: "apply_patch", args: [], cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } }, stdout: { async write() { assert.fail("invalid patch cannot publish"); } },
      stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } },
    });
    assert.equal(result.exitCode, 2);
    assert.equal(error, `apply_patch: ${message}\n`);
    assert.deepEqual(await fs.readdir("/"), []);
  });
}
