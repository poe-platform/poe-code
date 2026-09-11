import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { lineEndingCommands } from "../../../src/commands/line-endings/index.js";

const receipt = JSON.parse(readFileSync(new URL('./native.json', import.meta.url), 'utf8'));
for (const record of receipt.records) test(`independent native ${record.command}/${record.fixture.name}`, async () => {
  const fixture = record.fixture;
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  for (const [name, hex] of Object.entries(fixture.files ?? {})) {
    await fs.writeFile(`/work/${name}`, Buffer.from(hex as string, 'hex'));
    await fs.chmod!(`/work/${name}`, fixture.mode ?? 0o644);
    await fs.utimes!(`/work/${name}`, 1700000000000, 1700000000000);
  }
  for (const [name, target] of Object.entries(fixture.hardlinks ?? {})) await fs.link!(`/work/${target}`, `/work/${name}`);
  for (const [name, target] of Object.entries(fixture.symlinks ?? {})) await fs.symlink!(target as string, `/work/${name}`);
  for (const name of fixture.directories ?? []) await fs.mkdir(`/work/${name}`);
  const shell = new Shell({ fs, cwd: '/work', env: { LC_ALL: fixture.locale ?? 'C.UTF-8' } }).use(lineEndingCommands());
  try {
    const args = fixture.args.map((value: string) => `'${value.replaceAll("'", "'\\''")}'`).join(' ');
    const result = await shell.exec(`${record.command} ${args}`, { stdin: Buffer.from(fixture.input ?? '', 'hex') });
    assert.deepEqual({ status: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('hex'), stderr: Buffer.from(result.stderrBytes).toString('hex') }, { status: record.status, stdout: record.stdout, stderr: record.stderr });
    assert.deepEqual((await fs.readdir('/work')).map(entry => entry.name).sort(), Object.keys(record.after).sort());
    for (const [name, expected] of Object.entries(record.after) as [string, any][]) {
      const stat = await fs.lstat(`/work/${name}`);
      assert.equal(stat.type, expected.type, name);
      if (stat.type === 'file') {
        assert.equal(Buffer.from(await fs.readFile(`/work/${name}`)).toString('hex'), expected.hex, name);
        assert.equal(stat.mode & 0o777, expected.mode, `${name} permissions`);
        if (fixture.args.includes('-k')) assert.equal(stat.mtimeMs, expected.mtimeMs, `${name} mtime`);
      }
    }
  } finally { await shell.dispose(); }
});
