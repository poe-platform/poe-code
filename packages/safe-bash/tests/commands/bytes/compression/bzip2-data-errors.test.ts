import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shell } from '../../../../src/shell/shell.js';
import { agentCommands } from '../../../../src/plugins/index.js';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';
import { chunks, run } from './helpers.js';

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

  test(`${command} reports data errors as 2 and file errors as 1`, async () => {
    for (const input of [Buffer.alloc(0), Buffer.from('invalid')]) {
      const result = await run(command, ['-dc'], chunks(input));
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout.length, 0);
    }
    assert.equal((await run(command, ['-dc', '/missing'])).exitCode, 1);
  });
}

test('bzip2 streams complete output buffers but discards a truncated final buffer', async () => {
  const input = Buffer.alloc(12001, 120);
  const encoded = await run('bzip2', ['-c'], chunks(input));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const valid = await run('bzip2', ['-dc'], chunks(encoded.stdout));
  assert.equal(valid.exitCode, 0, valid.stderr);
  assert.deepEqual(valid.stdout, input);
  const result = await run('bzip2', ['-dc'], chunks(encoded.stdout.subarray(0, -1)));
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.stdout, input.subarray(0, 10000));
});

test('bzip2 output failures retain status 1', async () => {
  const encoded = await run('bzip2', ['-c'], chunks(Buffer.from('valid')));
  const result = await run('bzip2', ['-dc'], chunks(encoded.stdout), {
    stdout: { async write() { throw new Error('sink failure'); } },
  });
  assert.equal(result.exitCode, 1);
});
