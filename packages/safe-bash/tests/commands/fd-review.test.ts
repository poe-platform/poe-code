import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem, Shell, agentCommands } from '../../src/index.js';

async function fixture(files: Record<string, string>, run: (shell: Shell, fs: MemoryFileSystem) => Promise<void>): Promise<void> {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work', { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    await fs.mkdir('/work/' + path.split('/').slice(0, -1).join('/'), { recursive: true });
    await fs.writeFile('/work/' + path, new TextEncoder().encode(text));
  }
  const shell = new Shell({ fs, cwd: '/work' }).use(agentCommands());
  try { await run(shell, fs); } finally { await shell.dispose(); }
}

test('fd review: nested ignore overrides, directory pruning and explicit no-ignore', async () => {
  await fixture({ '.ignore': '*.tmp\nblocked/\n', 'keep.tmp': '', 'src/.ignore': '!keep.tmp\n', 'src/keep.tmp': '', 'blocked/secret': '', '.hidden': '' }, async shell => {
    const result = await shell.exec('fd -t f');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'src/keep.tmp\n');
    assert.equal((await shell.exec('fd -uu -t f')).stdout, '.hidden\n.ignore\nblocked/secret\nkeep.tmp\nsrc/.ignore\nsrc/keep.tmp\n');
    assert.equal((await shell.exec('fd -u -t f')).stdout, '.hidden\n.ignore\nblocked/secret\nkeep.tmp\nsrc/.ignore\nsrc/keep.tmp\n');
  });
});

test('fd review: parent ignores can be disabled separately', async () => {
  await fixture({ '.ignore': '*.tmp\n', 'src/keep.tmp': '', 'src/keep.txt': '' }, async shell => {
    assert.equal((await shell.exec("fd '' src -t f")).stdout, 'src/keep.txt\n');
    assert.equal((await shell.exec("fd '' src -t f --no-ignore-parent")).stdout, 'src/keep.tmp\nsrc/keep.txt\n');
  });
});

test('fd review: following a cycle keeps searching unrelated siblings', async () => {
  await fixture({ 'z-visible.txt': '' }, async (shell, fs) => {
    await fs.symlink('.', '/work/a-loop');
    const result = await shell.exec('fd -L -t f');
    assert.equal(result.stdout, 'z-visible.txt\n');
    assert.equal(result.exitCode, 0, result.stderr);
  });
});

test('fd review: following a dangling link keeps searching unrelated siblings', async () => {
  await fixture({ 'z-visible.txt': '' }, async (shell, fs) => {
    await fs.symlink('missing', '/work/a-dangling');
    const result = await shell.exec('fd -L -t f');
    assert.equal(result.stdout, 'z-visible.txt\n');
    assert.equal((await shell.exec('fd -L -t l')).stdout, 'a-dangling\n');
  });
});

test('fd review: regex, glob, fixed strings, and combined patterns remain distinct', async () => {
  await fixture({ 'foo.ts': '', 'fooXts': '', 'FOO.ts': '', 'bar.ts': '' }, async shell => {
    assert.equal((await shell.exec("fd '^foo[.]ts$'")).stdout, 'FOO.ts\nfoo.ts\n');
    assert.equal((await shell.exec("fd -s '^foo[.]ts$'")).stdout, 'foo.ts\n');
    assert.equal((await shell.exec("fd -F foo.ts")).stdout, 'FOO.ts\nfoo.ts\n');
    assert.equal((await shell.exec("fd -g '*.ts' --and 'foo*'")).stdout, 'FOO.ts\nfoo.ts\n');
    assert.equal((await shell.exec("fd -g '['")).exitCode, 1);
  });
});

test('fd review: literal execution preserves spaces and does not evaluate matched names', async () => {
  await fixture({ 'a space.txt': '', 'b$(echo injected).txt': '' }, async shell => {
    const single = await shell.exec("fd -t f -x printf '<%s>\\n' '{/}' ';'");
    assert.equal(single.exitCode, 0, single.stderr);
    assert.equal(single.stdout, '<a space.txt>\n<b$(echo injected).txt>\n');
    const batch = await shell.exec("fd -t f -X printf '<%s>\\n' '{}' ';'");
    assert.equal(batch.stdout, '<./a space.txt>\n<./b$(echo injected).txt>\n');
    assert.equal((await shell.exec("fd -t f -x false ';'")).exitCode, 1);
    assert.notEqual((await shell.exec("fd -t f -X printf '%s' 'X{}Y' '{}' ';'")).exitCode, 0);
  });
});

test('fd review: Unicode uppercase enables smart-case in every matching mode', async () => {
  await fixture({ 'ä.txt': '' }, async shell => {
    assert.equal((await shell.exec('fd Ä')).stdout, '');
    assert.equal((await shell.exec("fd -g 'Ä*'")).stdout, '');
    assert.equal((await shell.exec('fd -F Ä')).stdout, '');
    assert.equal((await shell.exec('fd -i Ä')).stdout, 'ä.txt\n');
  });
});

test('fd review: smart-case applies consistently across additional patterns', async () => {
  await fixture({ 'FOO.txt': '' }, async shell => {
    assert.equal((await shell.exec('fd foo --and F')).stdout, '');
    assert.equal((await shell.exec("fd -g 'foo*' --and 'F*'")).stdout, '');
    assert.equal((await shell.exec('fd -F foo --and F')).stdout, '');
  });
});

test('fd review: size units accept standard byte suffixes and reject fractional counts', async () => {
  await fixture({ 'decimal.bin': 'x'.repeat(1000), 'binary.bin': 'x'.repeat(1024) }, async shell => {
    assert.equal((await shell.exec('fd -S 1kb')).stdout, 'decimal.bin\n');
    assert.equal((await shell.exec('fd -S 1KiB')).stdout, 'binary.bin\n');
    assert.notEqual((await shell.exec('fd -S 1.5k')).exitCode, 0);
  });
});
