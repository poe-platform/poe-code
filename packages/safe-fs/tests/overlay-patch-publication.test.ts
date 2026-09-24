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
