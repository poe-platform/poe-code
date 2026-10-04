import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { standardCommands } from '../../src/commands/index.js';
import { structuredCommands } from '../../src/commands/structured/index.js';
import { searchCommands } from '../../src/commands/search/index.js';
import { createNodeRegexProvider } from '../../src/commands/regex-execution/client.js';

const enc = new TextEncoder();

test('pipeline byte quotas cover every edge and descriptor writes on every invocation', async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  for (const command of [
    'printf ab | cat | cat',
    'echo -n ab | cat | cat',
    '{ printf ab >&3; } 3>&1 | cat | cat',
    '{ printf ab >&2; } |& cat | cat',
    'echo "$(printf ab | cat | cat)"',
  ]) {
    for (let i = 0; i < 2; i++) {
      const result = await shell.exec(command, { limits: { maxPipelineBytes: 4 } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout.trimEnd(), 'ab', command);
      await assert.rejects(shell.exec(command, { limits: { maxPipelineBytes: 3 } }), { name: 'ShellLimitError', limit: 'maxPipelineBytes' });
    }
  }
  assert.equal((await shell.exec('printf ab', { limits: { maxPipelineBytes: 0 } })).stdout, 'ab');
  await assert.rejects(shell.exec('echo ab | cat', { limits: { maxPipelineBytes: 1 } }), { name: 'ShellLimitError', limit: 'maxPipelineBytes' });
  for (const command of ['pwd | cat', 'for i in 1 2; do echo x; done | cat']) {
    await assert.rejects(shell.exec(command, { limits: { maxPipelineBytes: 0 } }), { name: 'ShellLimitError', limit: 'maxPipelineBytes' });
  }
});

test('repeated pure pipelines honor each invocation locale and byte limits', async context => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/data.txt', enc.encode('a:b\na:A\na:a\na:B\n'.repeat(80)));
  const command = 'grep a /data.txt | cut -d: -f2 | sort | head -n 4';
  for (const variable of ['LC_ALL', 'LC_COLLATE']) {
    for (const locale of ['C', 'en_US.UTF-8', 'C']) {
      const shell = new Shell({ fs, env: { [variable]: locale } }).use(standardCommands());
      context.after(() => shell.dispose());
      for (let i = 0; i < 2; i++) {
        const result = await shell.exec(command);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, (locale === 'C' ? 'A\n' : 'a\n').repeat(4));
        const substitution = await shell.exec(`echo "$(${command})"`);
        assert.equal(substitution.stdout, result.stdout);
      }
      // Pipeline writes are included in the shell's output byte quota.
      for (const limit of ['maxInputBytes', 'maxOutputBytes', 'maxPipelineBytes'] as const) {
        await assert.rejects(shell.exec(command, { limits: { [limit]: 10 } }), { name: 'ShellLimitError', limit });
      }
    }
  }
  await fs.writeFile('/characters.txt', enc.encode('éa\n'.repeat(400)));
  const shell = new Shell({ fs }).use(standardCommands());
  context.after(() => shell.dispose());
  for (const locale of ['C', 'en_US.UTF-8', 'C']) {
    const result = await shell.exec(`export LC_ALL=${locale}; grep a /characters.txt | cut -c 1 | head -n 4`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, locale === 'C' ? Uint8Array.of(195, 10, 195, 10, 195, 10, 195, 10) : enc.encode('é\n'.repeat(4)));
  }
});

test('repeated 64-file rg walks honor budgets and parent ignore changes', async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work/tree', { recursive: true });
  for (let i = 0; i < 64; i++) await fs.writeFile(`/work/tree/file${i}.txt`, enc.encode('needle\n'.repeat(20)));
  const shell = new Shell({ fs, cwd: '/work' }).use(searchCommands());
  context.after(() => shell.dispose());
  const command = 'rg -c needle tree';
  for (let i = 0; i < 2; i++) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trim().split('\n').length, 64);
  }
  for (const limit of ['maxInputBytes', 'maxFileSystemOperations'] as const) {
    await assert.rejects(shell.exec(command, { limits: { [limit]: 10 } }), { name: 'ShellLimitError', limit });
  }
  await fs.mkdir('/work/.git');
  for (const ignore of ['.gitignore', '.ignore', '.rgignore']) {
    await fs.writeFile(`/work/${ignore}`, enc.encode('tree/*.txt\n'));
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout, '');
    await fs.unlink(`/work/${ignore}`);
    assert.equal((await shell.exec(command)).stdout.trim().split('\n').length, 64);
  }
});

test('rg reloads configuration when the environment or config file changes', async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/tree');
  for (let i = 0; i < 64; i++) await fs.writeFile(`/tree/f${i}`, enc.encode('NEEDLE\n'));
  await fs.writeFile('/sensitive', enc.encode('--case-sensitive\n'));
  await fs.writeFile('/insensitive', enc.encode('# settings\n\n--ignore-case\n'));
  const shell = new Shell({ fs }).use(searchCommands());
  context.after(() => shell.dispose());
  for (const path of ['/sensitive', '/insensitive', '/sensitive']) {
    const result = await shell.exec('rg -c needle /tree', { env: { RIPGREP_CONFIG_PATH: path } });
    assert.equal(result.exitCode, path === '/sensitive' ? 1 : 0, result.stderr);
    assert.equal(result.stdout.trim().split('\n').filter(Boolean).length, path === '/sensitive' ? 0 : 64);
  }
  await fs.writeFile('/sensitive', enc.encode('--ignore-case\n'));
  assert.equal((await shell.exec('rg -c needle /tree', { env: { RIPGREP_CONFIG_PATH: '/sensitive' } })).exitCode, 0);
  assert.equal((await shell.exec('rg --no-config -c needle /tree', { env: { RIPGREP_CONFIG_PATH: '/missing' } })).exitCode, 1);
  await assert.rejects(shell.exec('rg -c needle /tree', { env: { RIPGREP_CONFIG_PATH: '/sensitive' }, limits: { maxInputBytes: 3 } }), { name: 'ShellLimitError', limit: 'maxInputBytes' });
});
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


test('reported asynchronous and oversized pipelines settle before context reuse', async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/workspace');
  await fs.writeFile('/workspace/nums.txt', enc.encode('10\n2\n30\n1\n'));
  const largeLine = 'a'.repeat(70000) + '\n';
  await fs.writeFile('/workspace/big.txt', enc.encode(largeLine));
  const shell = new Shell({ fs, cwd: '/workspace' }).use(standardCommands());
  context.after(() => shell.dispose());
  const cases = [
    ['sort -n nums.txt | head -n 2', '1\n2\n'],
    ['sort -u nums.txt | head -n 2', '1\n10\n'],
    ['sort -k 1,1n nums.txt | head -n 2', '1\n2\n'],
    ['grep -E "^(1|2)$" nums.txt | head -n 2', '2\n1\n'],
    ['grep -i A big.txt | head -n 1', largeLine],
    ['grep a big.txt | head -n 1', largeLine],
    ['grep a /workspace/big.txt | head -n 1', largeLine],
    ['cut -z -c 1 nums.txt | head -n 1', '1\0'],
  ] as const;
  for (let iteration = 0; iteration < 2; iteration++) {
    for (const [command, expected] of cases) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, command + ': ' + result.stderr);
      assert.equal(result.stdout, expected, command);
      assert.equal(result.stderr, '', command);
    }
    for (const command of ['grep a /nonexistent | head -n 1', 'head -c 4 /nonexistent | wc -c']) {
      const result = await shell.exec('set -o pipefail; ' + command);
      assert.notEqual(result.exitCode, 0, command);
      assert.match(result.stderr, /nonexistent/);
      assert.equal(result.stdout.trim(), command.startsWith('head') ? '0' : '');
    }
  }
});

test('warmed pure pipelines finish UTF-8 grep, missing-file diagnostics and recursive find', async context => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/utf8.txt', enc.encode('alpha:café:1\nalpha:naïve:2\nbeta:3\n'));
  await fs.mkdir('/work/dir/nested', { recursive: true });
  await fs.writeFile('/work/dir/top.txt', enc.encode('top\n'));
  await fs.writeFile('/work/dir/nested/child.txt', enc.encode('child\n'));
  const shell = new Shell({ fs }).use(standardCommands());
  context.after(() => shell.dispose());
  await shell.exec('');
  for (let iteration = 0; iteration < 3; iteration++) {
    for (const command of [
      'grep alpha /utf8.txt | wc -l',
      'grep alpha /utf8.txt | cut -d: -f2 | sort | wc -l',
      'find /work/dir -name "*.txt" | wc -l',
    ]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, command);
      assert.equal(result.stdout, '2\n', command);
      assert.equal(result.stderr, '', command);
    }
    for (const pipefail of [false, true]) {
      const result = await shell.exec(`set ${pipefail ? '-o' : '+o'} pipefail; grep alpha /work/missing.txt | wc -l`);
      assert.equal(result.exitCode, pipefail ? 2 : 0);
      assert.equal(result.stdout, '0\n');
      assert.match(result.stderr, /missing\.txt/);
    }
  }
});

test('overlapping async pure pipelines keep output, diagnostics and budgets isolated', async context => {
  const shells = await Promise.all(['left', 'right'].map(async value => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/workspace');
    await fs.writeFile('/workspace/data', enc.encode('key:' + value + '\n' + 'x'.repeat(1050) + '\n'));
    const shell = new Shell({ fs }).use(standardCommands({ regexExecutor: createNodeRegexProvider() }));
    context.after(() => shell.dispose());
    return shell;
  }));
  for (let iteration = 0; iteration < 3; iteration++) {
    const results = await Promise.all(shells.map(shell => shell.exec('grep key /workspace/data | cut -d: -f2 | sort', { limits: { maxInputBytes: 1100, maxOutputBytes: 22 } })));
    assert.deepEqual(results.map(result => result.stdout), ['left\n', 'right\n']);
    assert.deepEqual(results.map(result => result.stderr), ['', '']);
    assert.deepEqual(results.map(result => result.exitCode), [0, 0]);
  }
});
