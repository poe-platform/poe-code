import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem, FileSystemCapabilities, FsOptions, RemoveOptions } from "../../src/contracts/index.js";

type Same<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2) ? true : false;

test("rmdir is an additive optional signal-only filesystem method", () => {
  const absent: Pick<FileSystem, "rmdir"> = {};
  const signature: Same<FileSystem["rmdir"],
    ((path: string, options?: FsOptions) => Promise<void>) | undefined> = true;
  const signalOnly: Same<keyof FsOptions, "signal"> = true;
  assert.equal(absent.rmdir, undefined);
  assert.equal(signature, true);
  assert.equal(signalOnly, true);
});

test("adding rmdir does not change the required rm contract", () => {
  const signature: Same<FileSystem["rm"],
    (path: string, options?: RemoveOptions) => Promise<void>> = true;
  const removeOptions: Same<keyof RemoveOptions, "recursive" | "force" | "signal"> = true;
  assert.equal(signature, true);
  assert.equal(removeOptions, true);
});

test("snapshot rmdir is an explicit optional readonly boolean disclosure", () => {
  const shape: Same<Pick<FileSystemCapabilities, "snapshotRmdir">,
    Readonly<{ snapshotRmdir?: boolean }>> = true;
  const omitted: FileSystemCapabilities = {};
  const strict: FileSystemCapabilities = { snapshotRmdir: false };
  const snapshot: FileSystemCapabilities = { snapshotRmdir: true };
  assert.equal(shape, true);
  assert.equal(omitted.snapshotRmdir, undefined);
  assert.equal(strict.snapshotRmdir, false);
  assert.equal(snapshot.snapshotRmdir, true);
});

test("snapshot disclosure preserves boolean extensions and optional method compatibility", () => {
  const extension: Same<FileSystemCapabilities[string], boolean | undefined> = true;
  const filesystem: Pick<FileSystem, "capabilities" | "rmdir"> = {
    capabilities: { snapshotRmdir: true, customProviderFeature: false },
  };
  assert.equal(extension, true);
  assert.equal(filesystem.rmdir, undefined);
  assert.equal(filesystem.capabilities.customProviderFeature, false);
});
