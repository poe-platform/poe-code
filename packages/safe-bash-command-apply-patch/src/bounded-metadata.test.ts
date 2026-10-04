import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { IndexedDocument } from "safe-bash-diff-engine/document";
import { PatchMetadata } from "./metadata.js";
import { parseDocument } from "./stored-parser.js";
import { createApplyPatchCommand } from "./index.js";
import { Work } from "./shared.js";
import { settings } from "./options.js";

for (const kind of ["add", "update"] as const) test(`patch ${kind} descriptors spill instead of retaining line and hunk arrays`, async t => {
  const fs = createMemoryFileSystem();
  let opens = 0;
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => { opens++; return open(...args); });
  const context: CommandContext = { command: "apply_patch", args: [], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const work = new Work(context, settings({}));
  const document = new IndexedDocument(work);
  const metadata = new PatchMetadata(document, work);
  const batches = kind === "add" ? 16 : 4;
  const encoder = new TextEncoder();
  const block = encoder.encode((kind === "add" ? "+x\n" : "@@ anchor\n-old\n+new\n").repeat(512));
  try {
    await document.load({ async *[Symbol.asyncIterator]() {
      yield encoder.encode(`*** Begin Patch\n*** ${kind === "add" ? "Add" : "Update"} File: /file\n`);
      for (let index = 0; index < batches; index++) yield block;
      yield encoder.encode("*** End Patch\n");
    } });
    const before = opens;
    const files = await parseDocument(document, work, metadata);
    const list = kind === "add" ? files[0]!.added : files[0]!.hunks;
    assert.equal(list.length, batches * 512);
    assert.equal(Array.isArray(list), false, "descriptor collections must not scale resident memory with patch lines");
    assert.equal(opens - before, 1, "all descriptors must share one caller-backed store");
    let count = 0;
    for await (const entry of list) {
      if ("anchors" in entry) {
        assert.equal(Array.isArray(entry.anchors), false);
        assert.equal(Array.isArray(entry.lines), false);
        assert.equal(entry.lines.length, 2);
      }
      count++;
    }
    assert.equal(count, batches * 512);
  } finally { await metadata.close(); await document.close(); work.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const failure of ["write", "cancel"] as const) test(`metadata spill ${failure} retires storage without publishing targets`, async t => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  await fs.writeFile("/existing", new TextEncoder().encode("unchanged\n"));
  let writes = 0, opens = 0, closes = 0;
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const descriptor = await open(...args); opens++;
    return new Proxy(descriptor, { get(target, key) {
      if (key === "write") return async () => {
        writes++;
        const error = new Error("metadata spill failed");
        if (failure === "cancel") controller.abort(error);
        throw error;
      };
      if (key === "close") return async (...args: Parameters<typeof descriptor.close>) => { closes++; await descriptor.close(...args); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  const block = new TextEncoder().encode("+x\n".repeat(512));
  await assert.rejects(Promise.resolve(createApplyPatchCommand().execute({
    command: "apply_patch", args: [], cwd: "/", env: {}, fs, signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode("*** Begin Patch\n*** Add File: /new\n");
      for (let index = 0; index < 12; index++) yield block;
      yield new TextEncoder().encode("*** End Patch\n");
    } },
    stdout: { async write() { assert.fail("failure must not publish success"); } }, stderr: { async write() {} },
  })), /metadata spill failed/u);
  assert.ok(writes > 0); assert.equal(opens, closes);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["existing"]);
  assert.equal(new TextDecoder().decode(await fs.readFile("/existing")), "unchanged\n");
});

test("matching replays a spilled context pattern without collecting its lines", async () => {
  const fs = createMemoryFileSystem();
  const encoder = new TextEncoder();
  const old = encoder.encode("same\n".repeat(512));
  await fs.writeStream("/file", { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 8; index++) yield old;
    yield encoder.encode("old\n");
  } });
  const block = encoder.encode(" same\n".repeat(512));
  let error = "";
  const result = await createApplyPatchCommand().execute({
    command: "apply_patch", args: [], cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {
      yield encoder.encode("*** Begin Patch\n*** Update File: /file\n@@\n");
      for (let index = 0; index < 8; index++) yield block;
      yield encoder.encode("-old\n+new\n*** End Patch\n");
    } }, stdout: { async write() { await Promise.resolve(); } }, stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 0, error);
  assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "same\n".repeat(4096) + "new\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["file"]);
});
