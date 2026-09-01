import assert from "node:assert/strict";
import { FsError, toFsError } from "@poe-platform/safe-fs/core";
import { createMemoryFileSystem, FsError as LegacyFsError } from "poe-code/safe-fs";

const filesystem = createMemoryFileSystem();
await assert.rejects(filesystem.readFile("/missing").catch(error => {
  assert.ok(error instanceof LegacyFsError);
  const canonical = toFsError(error);
  assert.ok(canonical instanceof FsError);
  assert.equal(canonical.code, error.code);
  assert.equal(canonical.path, error.path);
  if (!(error instanceof FsError)) assert.equal(canonical.cause, error);
  throw canonical;
}), error => error instanceof FsError && error.code === "ENOENT");
console.log("Legacy filesystem errors normalize at the canonical adapter boundary");
