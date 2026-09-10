import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, FsError, type FileSystem, type FileSystemCapabilities, type WriteFileOptions } from "../../../src/index.js";
import { binary, fixture, wrapped } from "./helpers.js";

const profiles = [
  { name: "global false", global: false, path: undefined, scoped: false, expected: undefined },
  { name: "path false overrides global true", global: true, path: false, scoped: true, expected: undefined },
  { name: "path true overrides global false", global: false, path: true, scoped: true, expected: 0o600 },
  { name: "path unknown overrides global false", global: false, path: undefined, scoped: true, expected: 0o600 },
  { name: "global true", global: true, path: undefined, scoped: false, expected: 0o600 },
  { name: "unknown permissions", global: undefined, path: undefined, scoped: false, expected: 0o600 },
] as const;

for (const streaming of [true, false]) for (const profile of profiles) {
  test(`tar publication honors ${profile.name} through ${streaming ? "streaming" : "buffered"} writes`, async () => {
    const base = createMemoryFileSystem();
    const capabilities: { -readonly [Key in keyof FileSystemCapabilities]: FileSystemCapabilities[Key] } = { ...base.capabilities, streamingWrite: streaming };
    if (profile.global === undefined) delete capabilities.permissions;
    else capabilities.permissions = profile.global;
    const writes: WriteFileOptions[] = [];
    const admission = (options: WriteFileOptions | undefined) => {
      assert.ok(options);
      writes.push(options);
      if (profile.expected === undefined && Object.hasOwn(options, "mode")) throw new FsError("ENOTSUP");
    };
    const overrides: Partial<FileSystem> = {
      capabilities,
      writeFile: async (path, bytes, options) => { admission(options); await base.writeFile(path, bytes, options); },
    };
    if (streaming) overrides.writeStream = async (path, bytes, options) => { admission(options); await base.writeStream(path, bytes, options); };
    else Object.defineProperty(overrides, "writeStream", { value: undefined });
    if (profile.scoped) overrides.capabilitiesFor = async () => {
      const scoped = { ...capabilities };
      if (profile.path === undefined) delete scoped.permissions;
      else scoped.permissions = profile.path;
      return scoped;
    };
    else Object.defineProperty(overrides, "capabilitiesFor", { value: undefined });
    const { shell } = await fixture({}, wrapped(base, overrides));
    try {
      await base.writeFile("/work/image.bin", binary);
      const result = await shell.exec("tar -cf /photos.tar image.bin");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(writes.length, 1);
      assert.equal(writes[0]!.flag, "wx");
      assert.equal(writes[0]!.mode, profile.expected);
      assert.equal(Object.hasOwn(writes[0]!, "mode"), profile.expected !== undefined);
      assert.ok(writes[0]!.signal instanceof AbortSignal);
      const extracted = await shell.exec("tar -xf /photos.tar -C /out");
      assert.equal(extracted.exitCode, 0, extracted.stderr);
      assert.equal(writes.length, 2);
      assert.equal(writes[1]!.mode, profile.expected);
      assert.equal(Object.hasOwn(writes[1]!, "mode"), profile.expected !== undefined);
      assert.equal(writes[1]!.flag, "wx");
      assert.deepEqual(await base.readFile("/out/image.bin"), binary);
    } finally {
      await shell.dispose();
    }
  });
}
