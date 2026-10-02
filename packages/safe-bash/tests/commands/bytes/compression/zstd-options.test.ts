import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';
import { Shell } from '../../../../src/shell/shell.js';
import { CommandRegistry } from '../../../../src/contracts/index.js';
import { createCompressionCommands } from '../../../../src/commands/bytes/compression/index.js';

const input = Buffer.from('supplemental zstd options\n'.repeat(20));
test('Zstd excludes compressed file names even with stdout and force, retaining VFS inputs', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/archive.gz', input);
  await fs.writeFile('/plain', input);
  const shell = new Shell({ fs, commands: new CommandRegistry(createCompressionCommands()) });
  const result = await shell.exec('zstd --exclude-compressed -fc /archive.gz /plain | unzstd -c');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, input.toString());
  assert.deepEqual(Buffer.from(await fs.readFile('/archive.gz')), input);
  assert.deepEqual(Buffer.from(await fs.readFile('/plain')), input);
});
