import assert from "node:assert/strict";
import { Shell, MemoryFileSystem, CommandRegistry } from "../../../dist/index.js";
import { createGrepAliasCommands, egrepCommand, fgrepCommand, grepAliasCommands, type GrepAliasOptions } from "../../../dist/commands/grep-aliases/index.js";

const options: GrepAliasOptions = { regex: { maxWorkers: 1, maxQueuedRequests: 2 }, replace: false };
assert.deepEqual(createGrepAliasCommands(options).map(command => command.name), ["egrep", "fgrep"]);
const standalone = new CommandRegistry([egrepCommand(options), fgrepCommand(options)]);
assert.equal(standalone.has("grep"), false);
const shell = new Shell({ fs: new MemoryFileSystem() }).use(grepAliasCommands(options));
try {
  const result = await shell.exec("egrep 'cat|dog' | fgrep 'cat'", { stdin: "cat\ndog\n" });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "cat\n");
  assert.equal(result.stderr, "");
  assert.equal(shell.commands.has("grep"), false);
  console.log("Built internal module and declarations consumed; root alias exports are not asserted.");
} finally { await shell.dispose(); }
