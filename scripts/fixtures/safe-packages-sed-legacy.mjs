import assert from 'node:assert/strict';
import { Shell, agentCommands, createTextProgramCommands, textProgramCommands } from '@poe-platform/safe-bash';
import { MemoryFileSystem } from '@poe-platform/safe-fs/core';
import { verification } from './safe-packages-sed.mjs';
await verification;
assert.deepEqual(createTextProgramCommands().map(command => command.name), ['sed', 'awk']);
const fs = new MemoryFileSystem();
await fs.writeFile('/input', new TextEncoder().encode('one\ntwo\n'));
await fs.writeFile('/script.sh', new TextEncoder().encode("sed 's/one/ONE/' /input | sed -n 1p"));
const shell = new Shell({ fs }).use(agentCommands());
try {
  const result = await shell.exec('sh /script.sh');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'ONE\n');
  shell.use(textProgramCommands({ replace: true, maxProgramInstructions: 1 }));
  const limited = await shell.exec('sed "p;p" /input');
  assert.equal(limited.exitCode, 2);
  assert.ok(limited.stderr.includes('program instruction limit'));
} finally { await shell.dispose(); }
console.log('Installed sed: legacy composition, VFS scripts, public byte/identity and cancellation boundaries passed');
