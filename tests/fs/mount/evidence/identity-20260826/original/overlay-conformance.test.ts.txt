import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes, toByteSource } from "../../../src/contracts/index.js";
import type { FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createOverlayFileSystem, OverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { decode, encode, errno, fixture } from "./helpers.js";

test("overlay exports construct independent FileSystem instances", async () => {
  const first: FileSystem = new OverlayFileSystem({ upper: new MemoryFileSystem(), lower: new MemoryFileSystem() });
  const second = createOverlayFileSystem({ upper: new MemoryFileSystem(), lower: new MemoryFileSystem() });
  await first.writeFile("/file", encode("first"));
  await assert.rejects(second.stat("/file"), errno("ENOENT"));
  assert.equal((await first.stat("/")).type, "directory");
  assert.throws(() => new OverlayFileSystem({ upper: first, lower: first }), TypeError);
});

test("binary payloads and read results are isolated at call time", async (context) => {
  const { overlay } = await fixture(context);
  const bytes = Uint8Array.from({ length: 1024 }, (_, index) => index % 256);
  const expected = new Uint8Array(bytes);
  const writing = overlay.writeFile("/file", bytes);
  bytes.fill(0);
  await writing;
  const result = await overlay.readFile("/file");
  assert.deepEqual(result, expected);
  result.fill(9);
  assert.deepEqual(await overlay.readFile("/file"), expected);
});

for (const layer of ["upper", "lower"] as const) {
  test(`${layer}: write flags, append, mode, and truncation conform`, async (context) => {
    const { overlay } = await fixture(context, async (lower, upper) => {
      await (layer === "lower" ? lower : upper).writeFile("/file", encode("old"), { mode: 0o640 });
    });
    for (const flag of ["wx", "ax"] as const) await assert.rejects(overlay.writeFile("/file", encode("bad"), { flag }), errno("EEXIST"));
    await overlay.writeFile("/file", encode("!"), { flag: "a", mode: 0o777 });
    assert.equal(decode(await overlay.readFile("/file")), "old!");
    assert.equal((await overlay.stat("/file")).mode & 0o7777, 0o640);
    await overlay.truncate("/file", 6);
    assert.deepEqual(await overlay.readFile("/file"), new Uint8Array([111, 108, 100, 33, 0, 0]));
    await overlay.truncate("/file", 2);
    assert.equal(decode(await overlay.readFile("/file")), "ol");
    await overlay.writeFile("/file", encode("new"));
    await overlay.appendFile("/created", encode("new"));
    await overlay.writeFile("/exclusive", encode("new"), { flag: "ax" });
    assert.equal(decode(await overlay.readFile("/file")), "new");
  });

  test(`${layer}: copyFile is independent and checks overlay exclusivity`, async (context) => {
    const { overlay } = await fixture(context, async (lower, upper) => {
      await (layer === "lower" ? lower : upper).writeFile("/file", encode("old"), { mode: 0o600 });
    });
    await overlay.copyFile("/file", "/copy");
    assert.equal((await overlay.stat("/copy")).mode & 0o7777, 0o600);
    await overlay.appendFile("/copy", encode("!"));
    assert.equal(decode(await overlay.readFile("/file")), "old");
    await assert.rejects(overlay.copyFile("/copy", "/file", { exclusive: true }), errno("EEXIST"));
    await overlay.copyFile("/file", "/file");
    await overlay.copyFile("/copy", "/file");
    assert.equal(decode(await overlay.readFile("/file")), "old!");
  });

  test(`${layer}: metadata updates preserve content and lower`, async (context) => {
    const { overlay } = await fixture(context, async (lower, upper) => {
      const backend = layer === "lower" ? lower : upper;
      await backend.mkdir("/dir");
      await backend.writeFile("/dir/file", encode("contents"), { mode: 0o640 });
      await backend.utimes("/dir/file", 1000, 2000);
    });
    const initial = await overlay.stat("/dir/file");
    await overlay.chmod("/dir/file", 0o600);
    assert.equal((await overlay.stat("/dir/file")).mtimeMs, 2000);
    assert.equal((await overlay.stat("/dir/file")).atimeMs, initial.atimeMs);
    await overlay.utimes("/dir/file", 3000, 4000);
    assert.equal((await overlay.stat("/dir/file")).mtimeMs, 4000);
    assert.equal((await overlay.stat("/dir/file")).atimeMs, 3000);
    assert.equal((await overlay.stat("/dir/file")).mode & 0o7777, 0o600);
    assert.equal(decode(await overlay.readFile("/dir/file")), "contents");
    await overlay.chmod("/dir", 0o700);
    await overlay.utimes("/dir", 5000, 6000);
    assert.equal((await overlay.stat("/dir")).mtimeMs, 6000);
  });

  test(`${layer}: directory rename preserves complete tree and symlinks`, async (context) => {
    const { overlay } = await fixture(context, async (lower, upper) => {
      const backend = layer === "lower" ? lower : upper;
      await backend.mkdir("/tree/sub", { recursive: true });
      await backend.writeFile("/tree/sub/file", encode("value"));
      await backend.symlink("sub/file", "/tree/link");
      await backend.writeFile("/tree-sibling", encode("sibling"));
    });
    await overlay.rename("/tree", "/moved");
    await assert.rejects(overlay.stat("/tree"), errno("ENOENT"));
    assert.equal(decode(await overlay.readFile("/moved/link")), "value");
    assert.equal(await overlay.readlink("/moved/link"), "sub/file");
    assert.equal(decode(await overlay.readFile("/tree-sibling")), "sibling");
    await overlay.rename("/moved", "/moved");
    await assert.rejects(overlay.rename("/absent", "/absent"), errno("ENOENT"));
    await assert.rejects(overlay.rename("/moved", "/moved/sub/nested"), errno("EINVAL"));
  });
}

test("recursive mkdir, merged listings, and error types", async (context) => {
  const { overlay } = await fixture(context);
  await assert.rejects(overlay.mkdir("/absent/child"), errno("ENOENT"));
  await overlay.mkdir("/parent/child/deep", { recursive: true, mode: 0o750 });
  await overlay.mkdir("/parent/child", { recursive: true });
  await overlay.writeFile("/parent/file", encode("value"));
  assert.deepEqual(await overlay.readdir("/parent"), [{ name: "child", type: "directory" }, { name: "file", type: "file" }]);
  assert.equal((await overlay.stat("/parent/child")).mode & 0o7777, 0o750);
  await assert.rejects(overlay.mkdir("/parent"), errno("EEXIST"));
  await assert.rejects(overlay.readFile("/parent"), errno("EISDIR"));
  await assert.rejects(overlay.writeFile("/parent", encode("bad")), errno("EISDIR"));
  await assert.rejects(overlay.readdir("/parent/file"), errno("ENOTDIR"));
  await assert.rejects(overlay.rm("/parent"), errno("ENOTEMPTY"));
  await assert.rejects(overlay.rm("/", { recursive: true }), errno("EBUSY"));
  await overlay.rm("/parent", { recursive: true });
  await overlay.rm("/absent", { force: true });
  await assert.rejects(overlay.rm("/absent"), errno("ENOENT"));
});

test("rename replacement type and nonempty checks leave entries intact", async (context) => {
  const { overlay } = await fixture(context, async (lower) => {
    await lower.mkdir("/dir");
    await lower.writeFile("/dir/file", encode("value"));
    await lower.writeFile("/file", encode("other"));
    await lower.mkdir("/empty");
  });
  await assert.rejects(overlay.rename("/file", "/dir"), errno("EISDIR"));
  await assert.rejects(overlay.rename("/dir", "/file"), errno("ENOTDIR"));
  await assert.rejects(overlay.rename("/empty", "/dir"), errno("ENOTEMPTY"));
  await overlay.rename("/dir/file", "/file");
  assert.equal(decode(await overlay.readFile("/file")), "value");
  await overlay.rename("/dir", "/empty");
  assert.deepEqual(await overlay.readdir("/empty"), []);
});

test("path validation does not collapse symlink-sensitive components", async (context) => {
  const { overlay } = await fixture(context, async (lower) => {
    await lower.mkdir("/tree/sub", { recursive: true });
    await lower.writeFile("/tree/value", encode("inside"));
    await lower.writeFile("/value", encode("outside"));
    await lower.symlink("tree/sub", "/link");
  });
  assert.equal(decode(await overlay.readFile("/link/../value")), "inside");
  assert.equal(await overlay.realpath("link/../value"), "/tree/value");
  await assert.rejects(overlay.stat("/value/"), errno("ENOTDIR"));
  await assert.rejects(overlay.stat("/value/../tree"), errno("ENOTDIR"));
  await assert.rejects(overlay.writeFile("/absent/file", encode("bad")), errno("ENOENT"));
  for (const path of ["", "/nul\0name", null, 23, {}]) {
    await assert.rejects(overlay.writeFile(path as string, encode("bad")), errno(path === "" ? "ENOENT" : "EINVAL"));
  }
  await assert.rejects(overlay.stat(`/${"x".repeat(256)}`), errno("ENAMETOOLONG"));
});

test("invalid values and flags reject without data loss", async (context) => {
  const { overlay } = await fixture(context);
  await overlay.writeFile("/file", encode("value"));
  for (const maxBytes of [-1, NaN, Infinity, 0.5]) await assert.rejects(overlay.readFile("/file", { maxBytes }), errno("EINVAL"));
  for (const mode of [-1, NaN, 0o10000, 0.5]) await assert.rejects(overlay.writeFile("/file", encode("bad"), { mode }), errno("EINVAL"));
  await assert.rejects(overlay.writeFile("/file", encode("bad"), { flag: "invalid" as "w" }), errno("EINVAL"));
  await assert.rejects(overlay.writeFile("/file", "bad" as unknown as Uint8Array), TypeError);
  await assert.rejects(overlay.access("/file", 8), errno("EINVAL"));
  await assert.rejects(overlay.utimes("/file", NaN, 0), errno("EINVAL"));
  await assert.rejects(overlay.truncate("/file", -1), errno("EINVAL"));
  assert.equal(decode(await overlay.readFile("/file")), "value");
});

test("owner permissions are checked before staged replacement", async (context) => {
  const { overlay } = await fixture(context);
  await overlay.writeFile("/readonly", encode("value"), { mode: 0o444 });
  await assert.rejects(overlay.writeFile("/readonly", encode("bad")), errno("EACCES"));
  await assert.rejects(overlay.access("/readonly", 2), errno("EACCES"));
  await overlay.access("/readonly", 4);
  await overlay.chmod("/readonly", 0o644);
  await overlay.appendFile("/readonly", encode("!"));
  await overlay.mkdir("/no-search", { mode: 0o600 });
  await assert.rejects(overlay.stat("/no-search/file"), errno("EACCES"));
});

test("delegated stream methods preserve flags, slicing, and source isolation", async (context) => {
  const { overlay } = await fixture(context, async (lower) => { await lower.writeFile("/file", encode("base")); });
  const reused = encode("12");
  await overlay.writeStream("/file", (async function* () { yield reused; reused.fill(51); yield reused; })(), { flag: "a" });
  assert.equal(decode(await overlay.readFile("/file")), "base1233");
  const sliced = await collectBytes(overlay.readStream("/file", { start: 2, endExclusive: 7, chunkSize: 2 }), { maxBytes: 20 });
  assert.equal(decode(sliced), "se123");
  await overlay.writeStream("/file", toByteSource("replacement"));
  assert.equal(decode(await overlay.readFile("/file")), "replacement");
  await assert.rejects(overlay.writeStream("/file", toByteSource("bad"), { flag: "wx" }), errno("EEXIST"));
  assert.equal(overlay.capabilities.streamingRead, true);
  assert.equal(overlay.capabilities.streamingWrite, true);
});
