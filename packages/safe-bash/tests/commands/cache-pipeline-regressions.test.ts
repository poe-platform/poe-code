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

for (const asynchronous of [false, true]) {
  test(`${asynchronous ? 'async' : 'sync'} matching pipelines retain negation on repeated runs`, async () => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs });
    await shell.use(standardCommands(asynchronous ? { regexExecutor: createNodeRegexProvider() } : {}));
    await fs.writeFile('/big.txt', enc.encode('key:value\n' + 'x'.repeat(1050) + '\n'));
    for (let iteration = 0; iteration < 3; iteration++) {
      await shell.exec('');
      const result = await shell.exec('! grep key /big.txt | cut -d: -f2 | sort');
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, 'value\n');
      assert.equal(result.stderr, '');
    }
  });
}

for (const wrap of [
  (query: string) => query,
  (query: string) => `echo "$(${query})"`,
]) test(`find output is isolated across tenants and directory mutations: ${wrap('find | sort')}`, async context => {
  const tenants = await Promise.all(['secret', 'public'].map(async prefix => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/work/dir', { recursive: true });
    await fs.writeFile('/work/dir/00_first.txt', enc.encode('a'));
    for (let i = 1; i <= 30; i++) await fs.writeFile(`/work/dir/${prefix}_${i}.txt`, enc.encode('a'));
    await fs.writeFile('/work/dir/31_last.txt', enc.encode('a'));
    const shell = new Shell({ fs }).use(standardCommands());
    context.after(() => shell.dispose());
    await shell.exec('');
    return { fs, shell };
  }));
  const [tenantA, tenantB] = tenants;
  const query = wrap("find /work/dir -name 'secret*' | sort");
  const check = async (tenant: typeof tenants[number], paths: string[]) => {
    const result = await tenant.shell.exec(query);
    const output = paths.sort().map(path => path + '\n').join('');
    assert.equal(result.stdout, output || (wrap('x') === 'x' ? '' : '\n'));
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, 0);
  };
  await check(tenantA!, Array.from({ length: 30 }, (_, i) => `/work/dir/secret_${i + 1}.txt`));
  await check(tenantB!, []);
  // Same entry count and boundary names, but a different middle name.
  await tenantB!.fs.rename('/work/dir/public_15.txt', '/work/dir/secret_new.txt');
  await check(tenantB!, ['/work/dir/secret_new.txt']);
  await tenantB!.fs.mkdir('/work/dir/nested');
  await check(tenantB!, ['/work/dir/secret_new.txt']);
  // The parent directory is unchanged when a descendant is added or renamed.
  await tenantB!.fs.writeFile('/work/dir/nested/secret_child.txt', enc.encode('a'));
  await check(tenantB!, ['/work/dir/nested/secret_child.txt', '/work/dir/secret_new.txt']);
  await tenantB!.fs.rename('/work/dir/nested/secret_child.txt', '/work/dir/nested/public_child.txt');
  await check(tenantB!, ['/work/dir/secret_new.txt']);
});

test('rg count does not reuse a same-length pattern with different middle bytes in one script', async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(searchCommands());
  context.after(() => shell.dispose());
  await fs.mkdir('/dir');
  await fs.writeFile('/dir/file.txt', enc.encode('foo\n'.repeat(16)));
  await shell.exec('');
  const result = await shell.exec('rg -c foo /dir; rg -c fXo /dir');
  assert.equal(result.stdout, '/dir/file.txt:16\n');
  assert.equal(result.stderr, '');
  assert.equal(result.exitCode, 1);
});
