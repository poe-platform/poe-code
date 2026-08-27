import assert from "node:assert/strict";
import { Shell, createMemoryFileSystem, createOverlayFileSystem, type CommandDefinition, type VirtualShellPlugin } from "virtual-bash";
import { createDuCommand, createDuCommands, duCommands, type DuCommandsOptions, type DuLimits } from "./node_modules/virtual-bash/dist/commands/du/index.js";

const limits: Partial<DuLimits> = { maxEntries: 64, maxOutputBytes: 1024 };
const options: DuCommandsOptions = { limits };
const command: CommandDefinition = createDuCommand(options);
const commands: readonly CommandDefinition[] = createDuCommands(options);
const plugin: VirtualShellPlugin = duCommands(options);
assert.equal(command.name, "du");
assert.deepEqual(commands.map(entry => entry.name), ["du"]);
const lower = createMemoryFileSystem();
const upper = createMemoryFileSystem();
await lower.writeFile("/payload", Uint8Array.of(0, 128, 255, 10));
const overlay = createOverlayFileSystem({ upper, lower });
const shell = new Shell({ fs: overlay }).use(plugin);
try {
  const result = await shell.exec("du -b /payload");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "4\t/payload\n");
  assert.equal(result.stderr, "");
  assert.deepEqual(await overlay.readFile("/payload"), Uint8Array.of(0, 128, 255, 10));
  const limited = new Shell({ fs: lower }).use(duCommands({ limits: { maxOutputBytes: 1 } }));
  try {
    const refusal = await limited.exec("du -b /payload");
    assert.equal(refusal.exitCode, 1);
    assert.equal(refusal.stdout, "");
    assert.equal(refusal.stderr, "");
    assert.deepEqual(await lower.readFile("/payload"), Uint8Array.of(0, 128, 255, 10));
  } finally { await limited.dispose(); }
} finally { await shell.dispose(); }
