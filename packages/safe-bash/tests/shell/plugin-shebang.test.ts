import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.js';
import { writeBytes, writeText } from '../../src/contracts/io.js';

for (const header of ['#!/usr/bin/python3 -u', '#!/bin/python3 -u', '#!/usr/bin/env -S python3 -u']) {
  test(`registered interpreter owns script decoding: ${header}`, async t => {
    const { fs, shell, commands } = setup();
    t.after(() => shell.dispose());
    const content = Buffer.concat([Buffer.from(`${header}\n# coding: latin-1\n`), Buffer.from([0xe9])]);
    await fs.writeFile('/program', content, { mode: 0o755 });
    commands.register({ name: 'python3', async execute(context) {
      assert.deepEqual(context.args, ['-u', './program', 'two words']);
      assert.equal(context.cwd, '/');
      assert.equal(context.env.VALUE, 'yes');
      assert.deepEqual(await context.fs.readFile('/program'), new Uint8Array(content));
      await writeBytes(context.stdout, new Uint8Array([0, 255]), context.signal);
      await writeText(context.stderr, 'diagnostic');
      return { exitCode: 23 };
    } });
    const result = await shell.exec("VALUE=yes ./program 'two words'");
    assert.equal(result.exitCode, 23, result.stderr);
    assert.deepEqual(result.stdoutBytes, new Uint8Array([0, 255]));
    assert.equal(result.stderr, 'diagnostic');
  });
}

test('env shell interpreter still validates source bytes', async t => {
  const { fs, shell } = setup();
  t.after(() => shell.dispose());
  await fs.writeFile('/program', Buffer.concat([Buffer.from('#!/usr/bin/env sh\n'), Buffer.from([0xff])]), { mode: 0o755 });
  const result = await shell.exec('/program');
  assert.equal(result.exitCode, 126);
  assert.match(result.stderr, /non-UTF-8/);
});
