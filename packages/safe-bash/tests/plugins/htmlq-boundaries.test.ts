import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { htmlq, htmlqCommands } from '../../src/commands/htmlq/index.js';
import { independentFixtures } from '../../../safe-bash-command-htmlq/src/independent-fixtures.js';

const encoder = new TextEncoder();

test('saved independent fixtures qualify CLI status, bytes and read-only effects', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(htmlqCommands());
  t.after(() => shell.dispose());
  for (const [id, source, argv, expected] of independentFixtures) {
    await fs.writeFile('/fixture', encoder.encode(source));
    const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";
    const result = await shell.exec('htmlq ' + argv.map(quote).join(' ') + ' -f /fixture');
    assert.equal(result.exitCode, 0, id);
    assert.equal(result.stderr, '', id);
    assert.deepEqual(encoder.encode(result.stdout), encoder.encode(expected), id);
    assert.deepEqual(await fs.readFile('/fixture'), encoder.encode(source), id);
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['fixture'], id);
  }
});

test('independent htmlq extraction composes with sort/uniq and jq without VFS effects', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(htmlqCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/saved.html', encoder.encode('<p>B</p><p>A</p><p>B</p><a href="/b"></a><a href="/a"></a>'));
  const before = await fs.readFile('/saved.html');
  const sorted = await shell.exec('htmlq p -t -f /saved.html | sort | uniq');
  assert.equal(sorted.exitCode, 0);
  assert.equal(sorted.stderr, '');
  assert.equal(sorted.stdout, 'A\nB\n');
  const json = await shell.exec('htmlq a -a href -f /saved.html | jq -R -s \'split("\\n") | map(select(length > 0))\'');
  assert.equal(json.exitCode, 0);
  assert.equal(json.stderr, '');
  assert.deepEqual(JSON.parse(json.stdout), ['/b', '/a']);
  assert.deepEqual(await fs.readFile('/saved.html'), before);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['saved.html']);
});

test('htmlq actual pipeline, redirect and VFS script agree with typed SDK', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(htmlqCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/input', encoder.encode('<p>A<b>B</b></p><p>C</p>'));
  await fs.writeFile('/run.sh', encoder.encode('cat /input | htmlq p -t > /output; cat /output'));
  const result = await shell.exec('sh /run.sh');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'AB\nC\n');
  assert.deepEqual(await fs.readFile('/output'), encoder.encode('AB\nC\n'));
  shell.use({ name: 'sdk-htmlq-boundary', setup(host) {
    host.commands.register({ name: 'sdk-htmlq', execute(context) {
      return htmlq(context, { selector: 'p', text: true, filename: '/input' });
    } });
  } });
  assert.deepEqual(await shell.exec('sdk-htmlq'), await shell.exec('htmlq p -t -f /input'));
});

test('htmlq atomic output reads source aliases fully and rejects destination symlinks', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(htmlqCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/source', encoder.encode('<p>A</p>'));
  await fs.symlink('/source', '/alias');
  assert.equal(await fs.realpath('/alias'), await fs.realpath('/source'));
  const result = await shell.exec('htmlq p -t -f /alias -o /source');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(await fs.readFile('/source'), encoder.encode('A\n'));
  const denied = await shell.exec('htmlq p -t -f /source -o /alias');
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.stderr, 'htmlq: E_UNSUPPORTED\n');
  assert.equal((await fs.lstat('/alias')).type, 'symlink');
  assert.deepEqual(await fs.readFile('/source'), encoder.encode('A\n'));
});

test('htmlq output quota rolls back files while stdout exposes an admitted prefix', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(htmlqCommands({ limits: { outputBytes: 3 } }));
  t.after(() => shell.dispose());
  await fs.writeFile('/input', encoder.encode('<p>A</p><p>B</p>'));
  await fs.writeFile('/existing', encoder.encode('KEEP'));
  for (const destination of ['/existing', '/new']) {
    const result = await shell.exec(`htmlq p -t -f /input -o ${destination}`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
  assert.deepEqual(await fs.readFile('/existing'), encoder.encode('KEEP'));
  await assert.rejects(fs.lstat('/new'), { code: 'ENOENT' });
  const streamed = await shell.exec('htmlq p -t -f /input');
  assert.equal(streamed.exitCode, 1);
  assert.equal(streamed.stdout, 'A\nB');
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['existing', 'input']);
});

test('htmlq shell redirect truncation is distinct from atomic output', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(htmlqCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/input', encoder.encode('<p>KEEP</p>'));
  await fs.symlink('/input', '/alias');
  const result = await shell.exec('htmlq p -t -f /input > /alias');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(await fs.readFile('/input'), new Uint8Array());
});

test('htmlq denied host paths and URLs never fetch or execute inert HTML', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, env: { SECRET: 'denied-credential' } }).use(htmlqCommands());
  t.after(() => shell.dispose());
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('network denied'); });
  for (const filename of ['/etc/passwd', '/usr/bin/htmlq', 'https://example.invalid/secret']) {
    const result = await shell.exec(`htmlq -f '${filename}'`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'htmlq: E_IO\n');
  }
  assert.equal((await shell.exec('/usr/bin/htmlq')).exitCode, 127);
  await fs.writeFile('/input', encoder.encode('<script>fetch("https://example.invalid/")</script><a href="javascript:SECRET">X</a>'));
  const raw = await shell.exec('htmlq script -t -f /input');
  assert.equal(raw.stdout, 'fetch("https://example.invalid/")\n');
  assert.equal((await shell.exec('htmlq a -a href -f /input')).stdout, 'javascript:SECRET\n');
  assert.equal(network.mock.callCount(), 0);
});

test('htmlq exclusive and replacement publication reject concurrent destination changes', async t => {
  for (const existing of [false, true]) {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(htmlqCommands());
    t.after(() => shell.dispose());
    await fs.writeFile('/input', encoder.encode('<p>NEW</p>'));
    if (existing) await fs.writeFile('/output', encoder.encode('OLD'));
    const publish = fs.writeFileConditional!.bind(fs);
    t.mock.method(fs, 'writeFileConditional', async (...[path, source, options]: Parameters<NonNullable<typeof fs.writeFileConditional>>) => {
      assert.equal(options.expected === null, !existing);
      await fs.writeFile(path, encoder.encode('CONCURRENT'));
      return publish(path, source, options);
    });
    const result = await shell.exec('htmlq p -t -f /input -o /output');
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'htmlq: E_IO\n');
    assert.deepEqual(await fs.readFile('/output'), encoder.encode('CONCURRENT'));
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['input', 'output']);
  }
});

test('disposing a Shell cancels htmlq pending parsing and awaits producer cleanup once', async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs });
  let started!: () => void, returned = 0;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const source = { [Symbol.asyncIterator]() { return {
    next() { started(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
    async return() { returned++; return { done: true as const, value: undefined }; }
  }; } };
  shell.use({ name: 'htmlq-disposal-control', setup(host) {
    host.commands.register({ name: 'pending-htmlq', execute(context) {
      return htmlq({ ...context, stdin: source }, { selector: 'p' });
    } });
  } });
  const result = shell.exec('pending-htmlq').then(value => ({ value }), error => ({ error }));
  await reading;
  await shell.dispose();
  const ended = await result;
  assert.ok('error' in ended || ended.value.exitCode !== 0);
  assert.equal(returned, 1);
  await shell.dispose();
  assert.equal(returned, 1);
});
