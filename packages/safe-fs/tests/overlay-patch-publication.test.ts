import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";

const bytes = (text: string) => new TextEncoder().encode(text);
async function fixture() {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await lower.mkdir("/work");
  await lower.writeFile("/work/file", bytes("original"));
  const fs = new OverlayFileSystem({ upper, lower });
  const ancestors = [{ path: "/", stat: await fs.lstat("/") }, { path: "/work", stat: await fs.lstat("/work") }];
  const parent = ancestors[1]!.stat;
  const destination = await fs.lstat("/work/file");
  const stage = await fs.createStagedFile("/work/.patch", "file", { type: "file", data: bytes("changed") }, { parent });
  return { fs, upper, lower, ancestors, parent, destination, stage };
}

test("overlay stages replace lower files, retain logical parents, and clean owned stages", async () => {
  const { fs, lower, ancestors, parent, destination, stage } = await fixture();
  assert.equal(fs.capabilities.atomicStagingAncestry, true);
  assert.equal((await fs.capabilitiesFor(stage.directory.path)).atomicFileStaging, true);
  assert.equal((await fs.lstat("/work")).ino, parent.ino);
  await fs.publishStagedFile(stage, "/work/file", { ancestors, parent, destination });
  await fs.removeStagedFile(stage);
  assert.deepEqual(await fs.readFile("/work/file"), bytes("changed"));
  assert.deepEqual(await lower.readFile("/work/file"), bytes("original"));
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["file"]);
});

for (const layer of ["upper", "lower"] as const) {
  for (const target of ["parent", "file"] as const) {
    test(`publication refuses ${layer} ${target} replacement`, async () => {
      const fixtureData = await fixture();
      const { fs, ancestors, parent, destination, stage } = fixtureData;
      const backend = fixtureData[layer];
      if (target === "parent") {
        await backend.rename("/work", "/old-work");
        await backend.mkdir("/work");
        await backend.writeFile("/work/file", bytes("foreign"));
      } else await backend.writeFile("/work/file", bytes("foreign"));
      await assert.rejects(fs.publishStagedFile(stage, "/work/file", { ancestors, parent, destination }), { code: "EAGAIN" });
      assert.deepEqual(await backend.readFile("/work/file"), bytes("foreign"));
    });
  }
}

test("confined lower removal publishes a whiteout and leaves lower bytes intact", async () => {
  const { fs, lower, stage } = await fixture();
  await fs.removeStagedFile(stage);
  const confined = await fs.confineExtraction(["/work"]);
  await confined.rm("/work/file");
  await assert.rejects(fs.lstat("/work/file"), { code: "ENOENT" });
  assert.deepEqual(await lower.readFile("/work/file"), bytes("original"));
});

test("confined mutations reject directory and symlink swaps in either layer", async () => {
  for (const layer of ["upper", "lower"] as const) {
    const data = await fixture();
    await data.fs.removeStagedFile(data.stage);
    const view = await data.fs.confineExtraction(["/work"]);
    await data[layer].rename("/work", "/old-work");
    await data[layer].symlink("/old-work", "/work");
    await assert.rejects(view.rm("/work/file"), { code: "EAGAIN" });
    assert.equal((await data[layer].lstat("/work")).type, "symlink");
    assert.deepEqual(await data.lower.readFile(layer === "lower" ? "/old-work/file" : "/work/file"), bytes("original"));
  }
});

test("cancellation leaves the destination untouched and permits owned cleanup", async () => {
  const { fs, parent, destination, ancestors, stage } = await fixture();
  const signal = AbortSignal.abort(new Error("cancelled"));
  await assert.rejects(fs.publishStagedFile(stage, "/work/file", { ancestors, parent, destination, signal }), /cancelled/);
  await fs.removeStagedFile(stage);
  assert.deepEqual(await fs.readFile("/work/file"), bytes("original"));
});

test("wrapped and modified Memory layers remain explicitly unsupported", async () => {
  const lower = new MemoryFileSystem(), upper = new MemoryFileSystem();
  const wrapped = new Proxy(lower, { get: (target, key) => {
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal(new OverlayFileSystem({ lower: wrapped, upper }).capabilities.atomicStagingAncestry, false);
  upper.mkdir = async () => {};
  assert.equal(new OverlayFileSystem({ lower, upper }).capabilities.atomicStagingAncestry, false);
});

test("logical directory identities belong to the overlay namespace", async () => {
  const { fs, upper, lower, parent, stage } = await fixture();
  const upperParent = await upper.lstat("/work"), lowerParent = await lower.lstat("/work");
  assert.notEqual(parent.identityScope, upperParent.identityScope);
  assert.notEqual(parent.identityScope, lowerParent.identityScope);
  const retained = await fs.openReadFile("/work", { allowDirectory: true });
  try {
    assert.equal((await retained.stat()).identityScope, parent.identityScope);
    assert.equal((await retained.stat()).ino, parent.ino);
  } finally { await retained.close(); }
  await fs.removeStagedFile(stage);
});

for (const target of ["directory", "file"] as const) {
  test(`cleanup preserves a foreign staging ${target}`, async () => {
    const { fs, upper, stage } = await fixture();
    const path = stage[target].path;
    await upper.rename(path, `${path}-foreign`);
    if (target === "directory") await upper.mkdir(path);
    else await upper.writeFile(path, bytes("foreign"));
    await assert.rejects(fs.removeStagedFile(stage), { code: "EAGAIN" });
    assert.equal((await upper.lstat(path)).type, target === "directory" ? "directory" : "file");
  });
}

test("late backend customization cannot gain composed mutation authority", async () => {
  const { fs, upper, stage, ancestors, parent, destination } = await fixture();
  const original = upper.publishStagedFile;
  let called = false;
  upper.publishStagedFile = async () => { called = true; };
  await assert.rejects(fs.publishStagedFile(stage, "/work/file", { ancestors, parent, destination }), { code: "ENOTSUP" });
  assert.equal(called, false);
  upper.publishStagedFile = original;
  await fs.removeStagedFile(stage);
});

test("confined failed upper removal cannot hide the selected entry", async () => {
  const { fs, upper, parent, ancestors, destination, stage } = await fixture();
  await fs.publishStagedFile(stage, "/work/file", { parent, ancestors, destination });
  await fs.removeStagedFile(stage);
  const view = await fs.confineExtraction(["/work"]);
  await upper.chmod("/work", 0o500);
  await assert.rejects(view.rm("/work/file"), { code: "EACCES" });
  assert.deepEqual(await fs.readFile("/work/file"), bytes("changed"));
});


test("confined pruning removes nested empty directories without invalidating shallower authority", async () => {
  const { fs, lower, stage } = await fixture();
  await fs.removeStagedFile(stage);
  const creation = await fs.confineExtraction(["/work"]);
  await creation.mkdir("/work/created");
  await creation.mkdir("/work/created/nested");
  const pruning = await fs.confineExtraction(["/work/created/nested", "/work/created"]);
  await pruning.rmdir!("/work/created/nested");
  await pruning.rmdir!("/work/created");
  await assert.rejects(fs.lstat("/work/created"), { code: "ENOENT" });
  assert.deepEqual(await lower.readFile("/work/file"), bytes("original"));
});

test("overlay retains cleanup and publishes with only parent and destination receipts", async () => {
  const { fs, lower, parent, destination, stage } = await fixture();
  assert.equal(fs.capabilities.retainedStagingCleanup, true);
  await fs.publishStagedFile(stage, "/work/file", { parent, destination });
  await fs.removeStagedFile(stage);
  assert.deepEqual(await fs.readFile("/work/file"), bytes("changed"));
  assert.deepEqual(await lower.readFile("/work/file"), bytes("original"));
});

test("implicit ancestry rejects ancestor replacement since staging admission", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await lower.mkdir("/a/b", { recursive: true });
  const fs = new OverlayFileSystem({ upper, lower });
  const parent = await fs.lstat("/a/b");
  const stage = await fs.createStagedFile("/a/b/.stage", "file", { type: "file", data: bytes("new") }, { parent });
  await lower.rename("/a", "/old");
  await lower.mkdir("/a");
  await lower.rename("/old/b", "/a/b");
  await assert.rejects(fs.publishStagedFile(stage, "/a/b/file", { parent, destination: null }), { code: "EAGAIN" });
  await fs.removeStagedFile(stage);
  await assert.rejects(fs.lstat("/a/b/file"), { code: "ENOENT" });
});

test("conditional mutation receipts survive ordinary stat snapshots", async () => {
  const { fs, lower, stage } = await fixture();
  await fs.removeStagedFile(stage);
  const parent = Object.freeze({ ...await fs.lstat("/work") });
  const expected = Object.freeze({ ...await fs.lstat("/work/file") });
  const written = await fs.writeFileConditional("/work/file", bytes("changed"), { parent, expected });
  await fs.removeFileConditional("/work/file", { parent, expected: Object.freeze({ ...written }) });
  await assert.rejects(fs.lstat("/work/file"), { code: "ENOENT" });
  assert.deepEqual(await lower.readFile("/work/file"), bytes("original"));
});

for (const layer of ["upper", "lower"] as const) test(`confined staging rejects ${layer} ancestor replacement and retains cleanup`, async () => {
  const data = await fixture();
  await data.fs.removeStagedFile(data.stage);
  const view = await data.fs.confineExtraction(["/work"]);
  const parent = await view.lstat("/work");
  const stage = await view.createStagedFile!("/work/.retained", "file", { type: "file", data: bytes("new") }, { parent, retainCleanup: true });
  await data[layer].rename("/work", "/old-work");
  await data[layer].mkdir("/work");
  await assert.rejects(view.publishStagedFile!({ ...stage }, "/work/new", { parent, destination: null }), { code: "EAGAIN" });
  await assert.rejects(view.createStagedFile!("/work/.late", "file", { type: "file", data: bytes("new") }, { parent }), { code: "EAGAIN" });
  await stage.cleanup!.remove();
  assert.deepEqual((await data.upper.readdir(layer === "upper" ? "/old-work" : "/work")).map(entry => entry.name), []);
});

test("confined staging refuses foreign stages and output paths", async () => {
  const { fs, stage, parent } = await fixture();
  const view = await fs.confineExtraction(["/work"]);
  await assert.rejects(view.publishStagedFile!(stage, "/work/foreign", { parent, destination: null }), { code: "ENOTSUP" });
  await assert.rejects(view.createStagedFile!("/.escape", "file", { type: "file", data: bytes("new") }, { parent: await fs.lstat("/") }), { code: "EPERM" });
  await fs.removeStagedFile(stage);
});

test("overlay conditionally creates directories and copies lower metadata without changing lower", async () => {
  const { fs, lower, stage } = await fixture();
  await fs.removeStagedFile(stage);
  const parent = await fs.lstat("/");
  const expected = await fs.lstat("/work");
  const directory = await fs.prepareDirectory!("/work", { parent, expected, mode: 0o750 });
  assert.equal(directory.mode & 0o777, 0o750);
  assert.equal((await lower.lstat("/work")).mode & 0o777, 0o777);
  const created = await fs.prepareDirectory!("/work/new", { parent: directory, expected: null, mode: 0o700 });
  assert.equal(created.type, "directory");
  assert.equal(created.mode & 0o777, 0o700);
  await assert.rejects(fs.prepareDirectory!("/work/new", { parent: directory, expected: null }), { code: "EAGAIN" });
});

test("confined directory preparation preserves roots and refuses escaped or replaced parents", async () => {
  const { fs, lower, stage } = await fixture();
  await fs.removeStagedFile(stage);
  const view = await fs.confineExtraction(["/work"]);
  const parent = await view.lstat("/work");
  const made = await view.prepareDirectory!("/work/new", { parent, expected: null, mode: 0o700 });
  assert.equal(made.type, "directory");
  await assert.rejects(view.prepareDirectory!("/escape", { parent: await fs.lstat("/"), expected: null }), { code: "EPERM" });
  await lower.rename("/work", "/old");
  await lower.mkdir("/work");
  await assert.rejects(view.prepareDirectory!("/work/new", { parent, expected: made, mode: 0o777 }), { code: "EAGAIN" });
});

test("closing retained cleanup still allows ordinary owned staging removal", async () => {
  const fs = new OverlayFileSystem({ upper: new MemoryFileSystem(), lower: new MemoryFileSystem() });
  const stage = await fs.createStagedFile("/.stage", "file", { type: "file", data: bytes("new") }, { parent: await fs.lstat("/"), retainCleanup: true });
  await stage.cleanup!.close();
  await fs.removeStagedFile(stage);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("overlay preserves retained staged writers and publishes their finished revision", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await lower.mkdir("/work");
  const fs = new OverlayFileSystem({ upper, lower });
  const parent = await fs.stat("/work");
  const stage = await fs.createStagedFile("/work/.stream", "file", {type: "file", data: new Uint8Array()}, {parent, retainCleanup: true});
  try {
    assert.ok(stage.writer);
    const chunk = bytes("first");
    await stage.writer.write(chunk); chunk.fill(0);
    await stage.writer.write(bytes("second"));
    const stat = await stage.writer.finish();
    assert.equal(stat.size, 11);
    await assert.rejects(stage.writer.write(bytes("late")), {code: "EBADF"});
    await fs.publishStagedFile({...stage, file: {...stage.file, stat}}, "/work/out", {parent, destination: null});
    assert.deepEqual(await fs.readFile("/work/out"), bytes("firstsecond"));
  } finally {await stage.cleanup!.remove();}
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["out"]);
});

test("overlay staged writes preserve cancellation and lower ancestry guards", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await lower.mkdir("/work");
  const fs = new OverlayFileSystem({upper, lower});
  const stage = await fs.createStagedFile("/work/.stream", "file", {type: "file", data: new Uint8Array()}, {parent: await fs.stat("/work"), retainCleanup: true});
  try {
    assert.ok(stage.writer);
    const reason = new Error("cancelled");
    await assert.rejects(stage.writer.write(bytes("cancelled"), {signal: AbortSignal.abort(reason)}), error => error === reason);
    assert.equal((await upper.stat(stage.file.path)).size, 0);
    await lower.rename("/work", "/old");
    await lower.mkdir("/work");
    await assert.rejects(stage.writer.write(bytes("foreign")), {code: "EAGAIN"});
    await assert.rejects(stage.writer.finish(), {code: "EAGAIN"});
    assert.equal((await upper.stat(stage.file.path)).size, 0);
  } finally {await stage.cleanup!.remove();}
});
