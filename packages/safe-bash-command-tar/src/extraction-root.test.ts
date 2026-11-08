import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget, settings } from "safe-bash-io-engine/commands/archive/internal";
import { readArchive } from "./extract.js";
import { parseOptions } from "./options.js";

for (const kind of ["file", "symlink"]) test(`archive root check rejects leaf ${kind} with ancestor diagnostic`, async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/target");
  if (kind === "file") await fs.writeFile("/out", new Uint8Array());
  else await fs.symlink!("/target", "/out");
  const context: CommandContext = {
    command: "tar", args: ["-xf", "-"], cwd: "/out", env: {}, fs,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal,
  };
  const limits = settings({});
  const options = await parseOptions(context, limits);
  assert.notEqual(options, "help");
  if (options === "help") throw new Error("unexpected help");
  // Visitors inspect the supplied filesystem without creating a confined view.
  await assert.rejects(readArchive(context, context.stdin, options, new Budget(context, limits), { async member() {} }),
    { message: "extraction root has a non-directory or symlink ancestor: /out" });
});
