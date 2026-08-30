import * as host from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createRealFileSystem } from '/Users/kjopek/Workspace/safe-bash/src/fs/real/index.ts';
import { createMetadataCommands } from '/Users/kjopek/Workspace/safe-bash/src/commands/metadata/index.ts';
import { toByteSource } from '/Users/kjopek/Workspace/safe-bash/src/contracts/index.ts';
const root = await host.mkdtemp('/tmp/safe-bash-metadata-leaf-calibrate-');
await host.writeFile(join(root, 'sentinel'), 'unchanged');
await host.mkdir(join(root, 'work'));
await host.writeFile(join(root, 'work/file'), 'data');
try {
  const fs = await createRealFileSystem({ root });
  for (const mode of ['g=s', 'u-s,g=s,o-t']) {
    await host.chmod(join(root, 'work/file'), 0o777);
    const native = spawnSync('/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/chmod', ['--', mode, 'file'], { cwd: join(root, 'work'), timeout: 2000, encoding: 'utf8', env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' } });
    assert.ifError(native.error);
    const nativeMode = (await host.stat(join(root, 'work/file'))).mode & 0o7777;
    await host.chmod(join(root, 'work/file'), 0o777);
    const errors = [];
    const command = createMetadataCommands().find(command => command.name === 'chmod');
    const result = await command.execute({ command: 'chmod', args: ['--', mode, 'file'], fs, cwd: '/work', env: {}, signal: new AbortController().signal, stdin: toByteSource(''), stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(Buffer.from(bytes)); } } });
    console.log(JSON.stringify({ mode, native: { code: native.status, stderr: native.stderr, mode: nativeMode.toString(8) }, real: { code: result.exitCode, stderr: Buffer.concat(errors).toString(), mode: ((await fs.stat('/work/file')).mode & 0o7777).toString(8) } }));
  }
  assert.equal(await host.readFile(join(root, 'sentinel'), 'utf8'), 'unchanged');
} finally {
  await host.rm(root, { recursive: true, force: true });
}
