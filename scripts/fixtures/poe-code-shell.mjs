import assert from "node:assert/strict";
import { Shell as RootShell, baseAgentCommands, createBoundedRegexProvider } from "poe-code/safe-bash";
import { Shell, CommandRegistry } from "poe-code/safe-bash/shell";
import { Shell as FullShell } from "poe-code/safe-bash/full";
import { baseAgentCommands as registryBase, createBoundedRegexProvider as registryRegex } from "poe-code/safe-bash/registry";
import { CommandRegistry as ContractRegistry } from "poe-code/safe-bash/contracts";
import { MemoryFileSystem } from "poe-code/safe-fs/core";
assert.equal(Shell, RootShell);
assert.equal(Shell, FullShell);
assert.equal(baseAgentCommands, registryBase);
assert.equal(createBoundedRegexProvider, registryRegex);
assert.equal(CommandRegistry, ContractRegistry);
const shell = new Shell({ fs: new MemoryFileSystem() }).use(registryBase());
try {
  assert.equal((await shell.exec("printf public")).stdout, "public");
} finally {
  await shell.dispose();
}
