import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileSystem } from "safe-bash-contracts";
import { createApplyPatchCommand } from "./index.js";

for (const failure of ["none", "write", "cancel"] as const) test(`target processing uses bounded reads and conditional streamed output: failure=${failure}`, async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  const block = new Uint8Array(16384).fill(120);
  await fs.writeStream("/file", { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 32; index++) yield block;
    yield new TextEncoder().encode("\nold\n");
  } });
  let opens = 0, closes = 0, publications = 0, supplied = 0, storage = 0;
  const wrap = (backing: FileSystem): FileSystem => new Proxy(backing, { get(target, key) {
    if (key === "readFile" || key === "writeFileConditional") return () => assert.fail("whole-target operation");
    if (key === "confineExtraction") return async (...args: Parameters<NonNullable<FileSystem["confineExtraction"]>>) => wrap(await target.confineExtraction!(...args));
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => { storage++; return target.open!(...args); };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<FileSystem["openReadFile"]>>) => {
      opens++;
      const handle = await target.openReadFile!(...args);
      return { ...handle,
        async read(...params: Parameters<typeof handle.read>) { assert.ok(params[1] <= 16384); return handle.read(...params); },
        async close() { closes++; await handle.close(); },
      };
    };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      const staging = await target.createStagedFile!(...args);
      return { ...staging, writer: { ...staging.writer!, async write(...params: Parameters<NonNullable<typeof staging.writer>["write"]>) {
        assert.ok(params[0].length <= 16384);
        if (++supplied === 3 && failure === "write") throw new Error("publication source failed");
        if (supplied === 3 && failure === "cancel") controller.abort(new Error("publication source failed"));
        await Promise.resolve();
        await staging.writer!.write(...params);
      } } };
    };
    if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<FileSystem["publishStagedFile"]>>) => {
      publications++; return target.publishStagedFile!(...args);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  let diagnostic = "";
  const operation = Promise.resolve(createApplyPatchCommand().execute({
    command: "apply_patch", args: [], cwd: "/", env: {}, fs: wrap(fs),
    stdin: toByteSource("*** Begin Patch\n*** Update File: /file\n@@\n-old\n+new\n*** End Patch\n"),
    signal: controller.signal,
    stdout: { async write() {} }, stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
  }));
  if (failure !== "none") await assert.rejects(operation, /publication source failed/u);
  else assert.equal((await operation).exitCode, 0, diagnostic);
  assert.equal(publications, failure !== "none" ? 0 : 1);
  assert.ok(storage >= 2, "input and replacement must spill through the injected backend");
  assert.ok(opens >= 2); assert.equal(closes, opens);
  const result = await fs.readFile("/file");
  assert.equal(result.length, 32 * 16384 + 5);
  assert.equal(new TextDecoder().decode(result.subarray(-5)), failure !== "none" ? "\nold\n" : "\nnew\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["file"]);
});

test("staged updates preserve hardlink identity and mode", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("old\n"), { mode: 0o640 });
  await fs.link("/file", "/alias");
  const before = await fs.stat("/file");
  let diagnostic = "";
  const result = await createApplyPatchCommand().execute({
    command: "apply_patch", args: [], cwd: "/", env: {}, fs,
    stdin: toByteSource("*** Begin Patch\n*** Update File: /file\n@@\n-old\n+new\n*** End Patch\n"),
    signal: new AbortController().signal, stdout: { async write() {} },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 0, diagnostic);
  const after = await fs.stat("/file");
  assert.equal(after.ino, before.ino); assert.equal(after.mode, before.mode);
  assert.equal(after.nlink, 2);
  assert.equal(new TextDecoder().decode(await fs.readFile("/alias")), "new\n");
});

test("retained target version changes reject before staging publication", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("old\n"));
  let closed = 0, publications = 0;
  const view = new Proxy(fs, { get(target, key) {
    if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
      const handle = await target.openReadFile(...args);
      return { ...handle,
        async read(...params: Parameters<typeof handle.read>) {
          const bytes = await handle.read(...params);
          await fs.writeFile("/file", new TextEncoder().encode("external\n"));
          return bytes;
        },
        async close() { closed++; await handle.close(); },
      };
    };
    if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
      publications++; return target.createStagedFile(...args);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  let diagnostic = "";
  const result = await createApplyPatchCommand().execute({
    command: "apply_patch", args: [], cwd: "/", env: {}, fs: view,
    stdin: toByteSource("*** Begin Patch\n*** Update File: /file\n@@\n-old\n+new\n*** End Patch\n"),
    signal: new AbortController().signal,
    stdout: { async write() { assert.fail("changed input must not publish success"); } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 1); assert.match(diagnostic, /target changed while reading/u);
  assert.equal(closed, 1); assert.equal(publications, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "external\n");
});
