import assert from "node:assert/strict";
import test from "node:test";
import {
  CommandRegistry, MemoryFileSystem, Shell, createMemoryFileSystem,
  createStandardCommands,
  makeSafeJsShellModule, standardCommands,
  S3FileSystem, S3RenameError, MockS3Client, createS3Transport, encodeCopySource,
  S3ServiceError, WebDavFileSystem,
  createTextProgramCommands, textProgramCommands,
} from "../../src/index.js";
import { RealFileSystem, createRealFileSystem, createNodeFsBridge, makeSafeJsFsModule } from "../../src/node.js";

test("portable root and explicit Node entry expose shell, filesystem, command, and SafeJS APIs", async () => {
  const fs = createMemoryFileSystem();
  assert.ok(fs instanceof MemoryFileSystem);
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()) });
  try {
    assert.equal((await shell.exec("printf root-exports")).stdout, "root-exports");
    for (const exported of [RealFileSystem, createRealFileSystem, standardCommands,
      createNodeFsBridge, makeSafeJsFsModule, makeSafeJsShellModule, S3FileSystem,
      S3RenameError, MockS3Client, createS3Transport, encodeCopySource, S3ServiceError,
      WebDavFileSystem, createTextProgramCommands, textProgramCommands]) assert.equal(typeof exported, "function");
  } finally { await shell.dispose(); }
});
