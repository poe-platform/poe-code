import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { csvcut, csvcutCommands } from '../../src/commands/csvcut/index.js';

const enc = new TextEncoder();
test('csvcut VFS script, pipeline and redirect match typed SDK bytes', async (t) => {
  const fs = createMemoryFileSystem(), shell = new Shell({ fs, env: {} }).use(agentCommands()).use(csvcutCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/input', enc.encode('id,id,note\na,b,\nshort\nx,y,0\n'));
  await fs.writeFile('/run.sh', enc.encode('cat /input | csvcut -xc note,id,note > /output; cat /output'));
  const result = await shell.exec('sh /run.sh');
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'note,id,note\n,a,\n,short,\n0,x,0\n');
  assert.deepEqual(await fs.readFile('/output'), enc.encode(result.stdout));
  shell.register({ name: 'sdk-cut', execute(context) { return csvcut(context, { include: 'note,id,note', deleteEmptyRows: true, filePath: '/input' }); } });
  assert.deepEqual(await shell.exec('sdk-cut'), await shell.exec('csvcut -xc note,id,note /input'));
});

test('csvcut quota failure leaves an opened redirect empty and prevents conditional publication', async (t) => {
  const fs = createMemoryFileSystem(), shell = new Shell({ fs }).use(agentCommands()).use(csvcutCommands({ limits: { outputBytes: 3 } }));
  t.after(() => shell.dispose());
  await fs.writeFile('/input', enc.encode('a\nx\n'));
  await fs.writeFile('/published', enc.encode('previous'));
  await fs.writeFile('/partial', enc.encode('previous temporary content'));
  const result = await shell.exec('csvcut /input > /partial && cp /partial /published');
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  assert.deepEqual(await fs.readFile('/partial'), new Uint8Array());
  assert.deepEqual(await fs.readFile('/published'), enc.encode('previous'));
});

test('csvcut Shell same-file and symlink redirects truncate before projection and are not atomic', async (t) => {
  for (const destination of ['/input', '/alias']) {
    const fs = createMemoryFileSystem(), shell = new Shell({ fs }).use(csvcutCommands());
    t.after(() => shell.dispose());
    await fs.writeFile('/input', enc.encode('a,b\nx,y\n')); await fs.symlink('/input', '/alias');
    assert.equal(await fs.realpath('/input'), await fs.realpath(destination));
    const result = await shell.exec(`csvcut /input > ${destination}`);
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, '');
    assert.deepEqual(await fs.readFile('/input'), enc.encode('\n'));
  }
});

test('csvcut treats host paths and URLs as absent VFS operands and never dispatches executable fallbacks', async (t) => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: {} }).use(csvcutCommands());
  t.after(() => shell.dispose());
  const denied = t.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden'); });
  for (const operand of ['/etc/passwd', 'https://example.invalid/input']) {
    const result = await shell.exec(`csvcut '${operand}'`);
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, '');
  }
  for (const command of ['/usr/bin/csvcut', 'python -m csvkit', 'curl https://example.invalid']) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 127); assert.equal(result.stdout, '');
  }
  assert.equal(denied.mock.callCount(), 0);
});
