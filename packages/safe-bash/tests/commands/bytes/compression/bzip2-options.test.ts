import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shell } from '../../../../src/shell/shell.js';
import { agentCommands } from '../../../../src/plugins/index.js';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';
test('reported bzip2 aliases round trip through agentCommands pipelines', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/input', Buffer.from('abc\n'));
  const shell = new Shell({ fs }).use(agentCommands());
  for (const flag of ['--compress', '--small']) {
    const result = await shell.exec(`bzip2 ${flag} -c /input | bzip2 -dc`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'abc\n');
    assert.equal(result.stderr, '');
  }
});
