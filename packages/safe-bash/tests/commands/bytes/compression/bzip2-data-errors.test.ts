import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shell } from '../../../../src/shell/shell.js';
import { agentCommands } from '../../../../src/plugins/index.js';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';

const truncated = [
  'QlpoOTFBWSZTWXdLsBQAAAAAgABAIAAhGEaC7kinChIO6XYC',
  'QlpoOTFBWSZTWQbk6Z4AAAFAgAAQAGAgADDMDHqCcXckU4UJAG5OmQ==',
];

for (const command of ['bzip2', 'bunzip2', 'bzcat']) {
  test(`${command} suppresses small truncated output through Shell`, async () => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(agentCommands());
    for (const fixture of truncated) {
      await fs.writeFile('/input', Buffer.from(fixture, 'base64'));
      const result = await shell.exec(`${command} -dc /input`);
      assert.equal(result.stdout, '');
      assert.equal(result.exitCode, 2);
      assert.match(result.stderr, /unexpected end of file/);
    }
  });

}
