import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, writeText } from "../../../src/contracts/index.js";
import { createStandardCommands } from "../../../src/commands/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

test("v2 supplemental: delivered #386 type -t builtin/file profile preserves registry descriptions and dispatch", async () => {
  const commands = new CommandRegistry(createStandardCommands());
  commands.register({ name: "v2registry", async execute({ stdout }) { await writeText(stdout, "plugin\n"); return { exitCode: 0 }; } });
  const shell = new Shell({ fs: new MemoryFileSystem(), commands, env: { PATH: "unused" } });
  const result = await shell.exec('type -t printf v2registry true; command -V printf v2registry true; type printf v2registry true; command v2registry; command printf "utility\\n"');
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
  // #386 (9cdb1c5) changes public type -t vocabulary, not implementation kind:
  // printf and v2registry remain registered commands with exact descriptions
  // and real plugin/utility dispatch below; true remains a shell builtin.
  assert.equal(result.stdout, "builtin\nfile\nbuiltin\nprintf is a registered command\nv2registry is a registered command\ntrue is a shell builtin\nprintf is a registered command\nv2registry is a registered command\ntrue is a shell builtin\nplugin\nutility\n");
});
