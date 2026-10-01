import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createCompressionCommands } from "../../src/commands/bytes/compression/index.js";
import { createXzCommand, xzCommands, type XzCommandsOptions } from "../../src/commands/xz/index.js";

for (const name of ["gzip", "bzip2", "xz", "zstd"]) {
  for (const args of [["-c"], ["-dc", "/input"], ["-c", "/input", "-"], ...(name === "zstd" ? [["-qqc", "/input"]] : [])]) {
    test(`${name} collection propagates host budgets: ${args.join(" ")}`, async () => {
      const command = createCompressionCommands().find(command => command.name === name)!;
      const fs = createMemoryFileSystem();
      await fs.writeFile("/input", Buffer.from("bounded input"));
      const failure = new Error("host input exceeded");
      await assert.rejects(async () => command.execute({
        command: name, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: toByteSource("bounded input"), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
        inputBudget: { maxBytes: 8, check(total) { if (total > 8) throw failure; } },
      }), error => error === failure);
    });
  }
}

test("public XZ adapter exposes the command and plugin factories", () => {
  const options: XzCommandsOptions = {};
  assert.equal(createXzCommand(options).name, "xz");
  assert.equal(xzCommands(options).name, "xz-commands");
});
