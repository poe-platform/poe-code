import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { searchCommands } from "../../src/commands/search/index.js";

for (const sorted of [true, false]) {
  for (const flags of ['', '-c', '-l', '-g "*.txt"']) {
    test(`rg charges memory filesystem operations: ${flags}, sorted=${sorted}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir('/d');
      const names = Array.from({ length: 50 }, (_, i) => `file_${String(i).padStart(3, '0')}.txt`);
      for (const name of sorted ? names : names.toReversed()) await fs.writeFile(`/d/${name}`, new TextEncoder().encode('match\n'));
      const command = `rg ${flags} match /d`;
      const baseline = await new Shell({ fs, cwd: '/' }).use(searchCommands()).exec(command);
      assert.equal(baseline.exitCode, 0, baseline.stderr);
      assert.equal(baseline.stdout.trim().split('\n').length, 50);
      const shell = new Shell({ fs, cwd: '/', limits: { maxFileSystemOperations: 5 } }).use(searchCommands());
      await assert.rejects(shell.exec(command), error => error instanceof ShellLimitError && error.limit === 'maxFileSystemOperations');
    });
  }
}

for (const depth of [0, 1, 2]) {
  test(`rg --max-depth ${depth} stops at the directory boundary`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir('/d');
    await fs.writeFile('/d/a_root.txt', new TextEncoder().encode('match_root\n'));
    await fs.mkdir('/d/sub');
    await fs.writeFile('/d/sub/a_sub.txt', new TextEncoder().encode('match_sub\n'));
    await fs.mkdir('/d/sub/deep');
    await fs.writeFile('/d/sub/deep/a_deep.txt', new TextEncoder().encode('match_deep\n'));
    const shell = new Shell({ fs, cwd: '/' }).use(searchCommands());
    for (const flag of ['--max-depth', '-d']) {
      const result = await shell.exec(`rg ${flag} ${depth} match /d`);
      assert.equal(result.exitCode, depth === 0 ? 1 : 0, result.stderr);
      assert.equal(result.stdout, ['/d/a_root.txt:match_root\n', '/d/sub/a_sub.txt:match_sub\n'].slice(0, depth).join(''));
    }
  });
}

test('rg --files charges direct memory directory enumeration', async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/d');
  for (let i = 0; i < 10; i++) {
    await fs.mkdir(`/d/dir${i}`);
    await fs.writeFile(`/d/dir${i}/file.txt`, new Uint8Array());
  }
  const baseline = await new Shell({ fs, cwd: '/' }).use(searchCommands()).exec('rg --files /d');
  assert.equal(baseline.exitCode, 0, baseline.stderr);
  assert.equal(baseline.stdout.trim().split('\n').length, 10);
  const shell = new Shell({ fs, cwd: '/', limits: { maxFileSystemOperations: 5 } }).use(searchCommands());
  await assert.rejects(shell.exec('rg --files /d'), error => error instanceof ShellLimitError && error.limit === 'maxFileSystemOperations');
});
