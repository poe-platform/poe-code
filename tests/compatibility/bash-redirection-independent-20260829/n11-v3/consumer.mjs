import assert from 'node:assert/strict';
import * as api from 'virtual-bash';
const memory = new api.MemoryFileSystem(), shell = new api.Shell({ fs: memory, cwd: '/' }).use(api.agentCommands());
const row = { id: 'N11-v3-later-open-error-uses-current-stderr', pass: false }; let entered = 0;
shell.commands.register({ name: 'emit', async execute(context) { entered++; await context.stdout.write(Buffer.from('O')); await context.stderr.write(Buffer.from('E')); return { exitCode: 0 }; } });
try {
  const result = await shell.exec('emit &>first &>/absent/out');
  row.observed = { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, entered, entries: await memory.readdir('/'), first: Buffer.from(await memory.readFile('/first')).toString('utf8') };
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, ''); assert.equal(entered, 0);
  assert.deepEqual(row.observed.entries, [{ name: 'first', type: 'file' }]);
  assert.equal(row.observed.first, 'shell: line 1: /absent/out: No such file or directory\n');
  row.pass = true;
} catch (error) { row.error = String(error.stack ?? error); }
finally { try { await shell.dispose(); row.disposed = true; } catch (error) { row.cleanupError = String(error); row.pass = false; } }
console.log(JSON.stringify(row)); console.log(JSON.stringify({ summary: { cases: 1, pass: row.pass ? 1 : 0, fail: row.pass ? 0 : 1 } })); process.exitCode = row.cleanupError ? 78 : row.pass ? 0 : 1;
