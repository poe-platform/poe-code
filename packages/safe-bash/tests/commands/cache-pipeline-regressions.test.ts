import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, MemoryFileSystem, standardCommands, structuredCommands } from '../../src/index.js';
import { searchCommands } from '../../src/commands/search/index.js';
import { createNodeRegexProvider } from '../../src/commands/regex-execution/client.js';

const enc = new TextEncoder();
test('rg counts distinguish full literal patterns', async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  await shell.use(searchCommands());
  await fs.mkdir('/dir', { recursive: true });
  await fs.writeFile('/dir/f', enc.encode('a1c\n'));
  await shell.exec('');
  assert.equal((await shell.exec('rg -c a1c /dir')).stdout, '/dir/f:1\n');
  await shell.exec('');
  const result = await shell.exec('rg -c a2c /dir');
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
});
test('scratch redirects cannot reuse stale search results', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  await shell.use(standardCommands());
  await shell.use(searchCommands());
  for (const value of ['abc', 'xyz']) {
    await shell.exec('rm -rf /dir && mkdir -p /dir');
    await shell.exec(`val=${value}; for i in 1; do echo "$val" > /dir/f; done`);
    await shell.exec('');
    const result = await shell.exec('rg -c abc /dir');
    assert.equal(result.exitCode, value === 'abc' ? 0 : 1);
    assert.equal(result.stdout, value === 'abc' ? '/dir/f:1\n' : '');
  }
});
test('reused caller buffers do not retain search and query cache identities', async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  await shell.use(standardCommands());
  await shell.use(structuredCommands());
  const buffer = enc.encode('key:old\n' + 'x'.repeat(1050) + '\n');
  const command = 'grep key /big.txt | cut -d: -f2 | sort';
  await fs.writeFile('/big.txt', buffer);
  await shell.exec('');
  assert.equal((await shell.exec(command)).stdout, 'old\n');
  await shell.exec('rm /big.txt');
  buffer.set(enc.encode('key:new'));
  await fs.writeFile('/big.txt', buffer);
  await shell.exec('');
  assert.equal((await shell.exec(command)).stdout, 'new\n');
  // The flat select/project source cache starts at 512 input bytes.
  const json = enc.encode('{"key":"old","enabled":true}\n'.repeat(32));
  await fs.writeFile('/data.json', json);
  assert.equal((await shell.exec('jq -c \'select(.enabled) | {key:.key}\' /data.json')).stdout, '{"key":"old"}\n'.repeat(32));
  await shell.exec('rm /data.json');
  json.set(enc.encode('{"key":"new","enabled":true}\n'.repeat(32)));
  await fs.writeFile('/data.json', json);
  assert.equal((await shell.exec('jq -c \'select(.enabled) | {key:.key}\' /data.json')).stdout, '{"key":"new"}\n'.repeat(32));
});
test('async regex stages finish all pipeline stages and retain contexts', async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  await shell.use(standardCommands({ regexExecutor: createNodeRegexProvider() }));
  await fs.writeFile('/big.txt', enc.encode('key:z\nkey:a\n' + 'x'.repeat(1050) + '\n'));
  await shell.exec('');
  assert.equal((await shell.exec('grep key /big.txt | cut -d: -f2 | sort')).stdout, 'a\nz\n');
});

test('same-size scratch redirects retain each file content', async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  await shell.use(standardCommands());
  await shell.exec('mkdir -p /dir');
  await shell.exec('');
  await shell.exec('for val in abc xyz; do echo "$val" > /dir/$val; done');
  assert.equal((await shell.exec('cat /dir/abc /dir/xyz')).stdout, 'abc\nxyz\n');
});
test('async pipeline preserves pipefail, negation, and stage statuses', async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  await shell.use(standardCommands({ regexExecutor: createNodeRegexProvider() }));
  await fs.writeFile('/big.txt', enc.encode('other:value\n' + 'x'.repeat(1050) + '\n'));
  await shell.exec('');
  const pipeline = 'grep key /big.txt | cut -d: -f2 | sort';
  assert.equal((await shell.exec(pipeline)).exitCode, 0);
  assert.equal((await shell.exec(pipeline + '; echo "${PIPESTATUS[@]}"')).stdout, '1 0 0\n');
  assert.equal((await shell.exec('set -o pipefail; ' + pipeline)).exitCode, 1);
  assert.equal((await shell.exec('set -o pipefail; ! ' + pipeline)).exitCode, 0);
});
