import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { diff3, diff3Commands } from '../../src/commands/diff3/index.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const merged = 'a\n<<<<<<< /ours\nours\n||||||| /base\nbase\n=======\ntheirs\n>>>>>>> /theirs\nz\n';
async function fixture() {
  const fs = createMemoryFileSystem();
  for (const [path, text] of [['/ours', 'a\nours\nz\n'], ['/base', 'a\nbase\nz\n'], ['/theirs', 'a\ntheirs\nz\n']]) await fs.writeFile(path!, bytes(text!));
  const shell = new Shell({ fs }).use(agentCommands()).use(diff3Commands());
  return { fs, shell };
}

test('diff3 executes VFS scripts, pipes and redirects with literal SDK parity', async t => {
  const { fs, shell } = await fixture();
  t.after(() => shell.dispose());
  shell.register({ name: 'sdk-diff3', execute(context) { return diff3(context, { files: ['/ours', '/base', '/theirs'], merge: true }); } });
  const cli = await shell.exec('diff3 -m /ours /base /theirs');
  assert.equal(cli.exitCode, 1); assert.equal(cli.stdout, merged); assert.equal(cli.stderr, '');
  assert.deepEqual(await shell.exec('sdk-diff3'), cli);
  await fs.writeFile('/run.sh', bytes('cat /ours | diff3 -m - /base /theirs > /merged\nstatus=$?\ncat /merged\nexit "$status"\n'));
  const script = await shell.exec('sh /run.sh');
  assert.equal(script.exitCode, 1); assert.equal(script.stderr, '');
  assert.equal(script.stdout, merged.replace('/ours', '-'));
  assert.deepEqual(await fs.readFile('/merged'), bytes(script.stdout));
  const pipe = await shell.exec('diff3 -m /ours /base /theirs | cat');
  assert.equal(pipe.exitCode, 0); assert.equal(pipe.stdout, merged);
  assert.deepEqual(await fs.readFile('/ours'), bytes('a\nours\nz\n'));
});

test('diff3 redirects truncate same-file symlink aliases before operand reads', async t => {
  const { fs, shell } = await fixture();
  t.after(() => shell.dispose());
  await fs.symlink('/ours', '/alias');
  assert.equal(await fs.realpath('/alias'), await fs.realpath('/ours'));
  const result = await shell.exec('diff3 -m /ours /base /theirs > /alias');
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  const output = new TextDecoder().decode(await fs.readFile('/ours'));
  assert.equal(output, '<<<<<<< /ours\n||||||| /base\na\nbase\nz\n=======\na\ntheirs\nz\n>>>>>>> /theirs\n');
  // Shell publication is destructive streaming, not a diff3 atomic file API.
  assert.deepEqual(await fs.readFile('/alias'), bytes(output));
});

test('quota failure publishes no diff3 stdout but does not undo shell truncation', async t => {
  const { fs, shell } = await fixture();
  t.after(() => shell.dispose());
  shell.use(diff3Commands({ replace: true, limits: { inputBytes: 1 } }));
  await fs.writeFile('/result', bytes('previous result'));
  const result = await shell.exec('diff3 -m /ours /base /theirs > /result');
  assert.equal(result.exitCode, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, /resource limit/);
  assert.deepEqual(await fs.readFile('/result'), new Uint8Array());
  assert.deepEqual(await fs.readFile('/ours'), bytes('a\nours\nz\n'));
  shell.use(diff3Commands({ replace: true }));
  assert.equal((await shell.exec('diff3 -m /ours /base /theirs')).stdout, merged);
});

test('missing VFS operands and executable selection cannot acquire host or network authority', async t => {
  const { fs, shell } = await fixture();
  t.after(() => shell.dispose());
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('Network denied'); });
  for (const operand of ['/etc/passwd', '/usr/bin/diff3', 'https://example.invalid/secret']) {
    const result = await shell.exec(`diff3 -m '${operand}' /base /theirs`);
    assert.equal(result.exitCode, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, /VFS read failed/);
  }
  for (const option of ['--diff-program=/usr/bin/diff', '--diff-program=https://example.invalid/engine']) {
    const result = await shell.exec(`diff3 '${option}' /ours /base /theirs`);
    assert.equal(result.exitCode, 2); assert.equal(result.stdout, '');
  }
  assert.equal((await shell.exec('/usr/bin/diff3 /ours /base /theirs')).exitCode, 127);
  await fs.mkdir('/directory');
  assert.equal((await shell.exec('diff3 /directory /base /theirs')).exitCode, 2);
  assert.equal(network.mock.callCount(), 0);
});

test('Shell cancellation and disposal return a cooperative diff3 input before settling', async () => {
  for (const action of ['cancel', 'dispose'] as const) {
    const fs = createMemoryFileSystem(), controller = new AbortController();
    let started!: () => void, finish!: () => void, closed = 0;
    const admitted = new Promise<void>(done => { started = done; });
    const released = new Promise<void>(done => { finish = done; });
    const source = { [Symbol.asyncIterator]() { return {
      async next() { started(); await released; return { done: false as const, value: bytes('late\n') }; },
      async return() { closed++; return { done: true as const, value: undefined }; }
    }; } };
    const shell = new Shell({ fs }).use(diff3Commands());
    const running = shell.exec('diff3 -m - /base /theirs', { stdin: source, signal: controller.signal });
    // Attach a handler before initiating cancellation, avoiding orphan rejection.
    const observed = running.then(value => ({ value }), error => ({ error }));
    await admitted;
    if (action === 'cancel') controller.abort(false);
    const disposing = shell.dispose();
    let settled = false;
    void disposing.then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
    finish();
    const outcome = await observed;
    assert.ok('error' in outcome);
    if (action === 'cancel') assert.equal(outcome.error, false);
    await disposing; await shell.dispose(); assert.equal(closed, 1);
  }
});
