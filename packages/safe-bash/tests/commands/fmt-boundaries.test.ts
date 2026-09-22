import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandRegistry } from '../../src/contracts/index.js';
import { fmt, fmtCommand } from '../../src/commands/fmt/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { Shell } from '../../src/shell/index.js';
import { agentCommands } from '../../src/index.js';

const encode = (value: string) => new TextEncoder().encode(value);

test('fmt VFS script pipelines and typed SDK publish identical redirect bytes', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input', encode('aa bb cc dd ee'));
  await fs.writeFile('/run.sh', encode('cat /input | fmt -w8 > /cli; fmt-sdk > /sdk'));
  const shell = new Shell({ fs, env: { LC_ALL: 'C' } }).use(agentCommands());
  shell.commands.register({ name: 'fmt-sdk', execute(context) { return fmt(context, { width: 8, files: ['/input'] }); } });
  try {
    const result = await shell.exec('sh /run.sh');
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, '', '']);
    assert.deepEqual(await fs.readFile('/cli'), encode('aa bb cc\ndd ee\n'));
    assert.deepEqual(await fs.readFile('/sdk'), await fs.readFile('/cli'));
    assert.deepEqual(await fs.readFile('/input'), encode('aa bb cc dd ee'));
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['cli', 'input', 'run.sh', 'sdk']);
  } finally { await shell.dispose(); }
});

for (const destination of ['/input', '/alias']) test(`fmt redirect to source ${destination} has explicit Shell truncation semantics`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input', encode('original words'));
  await fs.symlink('/input', '/alias');
  const shell = new Shell({ fs, commands: new CommandRegistry([fmtCommand()]) });
  try {
    const result = await shell.exec(`fmt /input > ${destination}`);
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, '', '']);
    assert.deepEqual(await fs.readFile('/input'), new Uint8Array());
    assert.equal((await fs.lstat('/alias')).type, 'symlink');
  } finally { await shell.dispose(); }
});

for (const destination of ['/input', '/alias']) test(`unsupported noclobber cannot authorize fmt publication through ${destination}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input', encode('original words'));
  await fs.symlink('/input', '/alias');
  let acquired = 0;
  const original = fs.readStream.bind(fs);
  fs.readStream = (path, options) => { acquired++; return original(path, options); };
  const shell = new Shell({ fs, commands: new CommandRegistry([fmtCommand()]) });
  try {
    const result = await shell.exec(`set -o noclobber && fmt /input > ${destination}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /unsupported shell option/);
    assert.equal(acquired, 0);
    assert.deepEqual(await fs.readFile('/input'), encode('original words'));
  } finally { await shell.dispose(); }
});

test('fmt output quota leaves bounded partial redirect output, without rollback or temporary files', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input', encode('A'.repeat(10001) + ' end'));
  const shell = new Shell({ fs, commands: new CommandRegistry([fmtCommand({ limits: { outputBytes: 1500 } })]) });
  try {
    const result = await shell.exec('fmt -w20 /input > /output');
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /limit exceeded/);
    const bytes = await fs.readFile('/output');
    assert.ok(bytes.length > 0 && bytes.length <= 1500);
    assert.deepEqual(bytes, encode('A'.repeat(bytes.length)));
    assert.deepEqual(await fs.readFile('/input'), encode('A'.repeat(10001) + ' end'));
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['input', 'output']);
  } finally { await shell.dispose(); }
});

test('fmt treats host paths and URLs as VFS operands and has no executable fallback', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' }, commands: new CommandRegistry([fmtCommand()]) });
  try {
    for (const command of ['fmt /etc/passwd', 'fmt /proc/self/environ', 'fmt https://example.invalid/credentials']) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /No such file or directory/);
    }
    for (const command of ['/usr/bin/fmt', 'curl https://example.invalid/', 'node -e process.env']) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 127);
      assert.equal(result.stdout, '');
    }
  } finally { await shell.dispose(); }
});

for (const limits of [{ inputBytes: 5 }, { work: 0 }, { retainedBytes: 1 }]) test(`fmt Shell rejects ${JSON.stringify(limits)} and remains usable after cleanup`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/first', encode('one'));
  await fs.writeFile('/second', encode('two'));
  const shell = new Shell({ fs, commands: new CommandRegistry([fmtCommand({ limits })]) });
  try {
    const result = await shell.exec('fmt /first /second');
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /limit|retention/i);
    assert.deepEqual(await fs.readFile('/first'), encode('one'));
    assert.deepEqual(await fs.readFile('/second'), encode('two'));
    const help = await shell.exec('fmt --help');
    assert.equal(help.exitCode, 0);
    assert.equal(help.stderr, '');
    assert.match(help.stdout, /^Usage: fmt/);
  } finally { await shell.dispose(); }
});
