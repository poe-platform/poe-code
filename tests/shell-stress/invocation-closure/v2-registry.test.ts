import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, writeText } from "../../../src/contracts/index.js";
import { createStandardCommands } from "../../../src/commands/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

test("v2 supplemental: registered printf/plugin remain truthful commands, true remains builtin", async () => {
  const commands = new CommandRegistry(createStandardCommands());
  commands.register({ name: "v2registry", async execute({ stdout }) { await writeText(stdout, "plugin\n"); return { exitCode: 0 }; } });
  const shell = new Shell({ fs: new MemoryFileSystem(), commands, env: { PATH: "unused" } });
  const result = await shell.exec('type -t printf v2registry true; command -V printf v2registry true; type printf v2registry true; command v2registry; command printf "utility\\n"');
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
  assert.equal(result.stdout, "command\ncommand\nbuiltin\nprintf is a registered command\nv2registry is a registered command\ntrue is a shell builtin\nprintf is a registered command\nv2registry is a registered command\ntrue is a shell builtin\nplugin\nutility\n");
});
