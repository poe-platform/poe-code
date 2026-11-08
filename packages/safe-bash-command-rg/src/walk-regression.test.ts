import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";
import { Glob } from "./glob.js";
import { RegexSession } from "safe-bash-regex-engine/execution/portable";

test('file discovery validates ignore patterns once but skips impossible matches', async (t) => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/repo/src', { recursive: true });
  await fs.writeFile('/repo/.ignore', new TextEncoder().encode('node_modules/\n/dist/\n*.log\n!keep.log\n'));
  for (const name of ['index.ts', 'skip.log', 'keep.log']) await fs.writeFile(`/repo/src/${name}`, new Uint8Array());
  const run = t.mock.method(RegexSession.prototype, 'run');
  const values = createCommandArguments(['--files', 'src']);
  let stdout = '', stderr = '';
  const result = await createRgCommand().execute({
    command: 'rg', args: values.args, argumentValues: values, cwd: '/repo', env: {}, fs,
    stdin: toByteSource(''), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stdout, 'src/index.ts\nsrc/keep.log\n');
  const requests = run.mock.calls.map(call => call.arguments);
  assert.ok(requests.some(([descriptor, rows]) => descriptor.kind === 'glob' && rows.length === 0 && descriptor.patterns.includes('node_modules/')));
  assert.ok(requests.every(([descriptor, rows]) => descriptor.kind !== 'glob' || rows.length === 0 || !descriptor.patterns.includes('node_modules/')),
    'unrelated ignore patterns must not be compiled and matched for each entry');
});

for (const sorted of [false, true]) {
  for (const depth of [0, 1, 2]) {
    test(`rg depth ${depth} is independent of insertion order (sorted=${sorted})`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir('/b_sub');
      const needle = new TextEncoder().encode('needle\n');
      if (!sorted) await fs.writeFile('/b_sub/mid.txt', needle);
      await fs.mkdir('/b_sub/deep');
      await fs.writeFile('/b_sub/deep/bot.txt', needle);
      if (sorted) await fs.writeFile('/b_sub/mid.txt', needle);
      const values = createCommandArguments(['--max-depth', String(depth), 'needle', '/b_sub']);
      let stdout = '', stderr = '';
      const context = {
        command: 'rg', args: values.args, argumentValues: values, cwd: '/', env: {}, fs,
        _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true,
        stdin: toByteSource(''), signal: new AbortController().signal,
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
      };
      const result = await createRgCommand().execute(context);
      assert.equal(stderr, '');
      assert.equal(result.exitCode, depth === 0 ? 1 : 0);
      assert.equal(stdout, depth === 0 ? '' : depth === 1 ? '/b_sub/mid.txt:needle\n' : '/b_sub/deep/bot.txt:needle\n/b_sub/mid.txt:needle\n');
    });
  }
}

test('rg reads ignore rules and emits JSON paths without Buffer', async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/d');
  for (const [name, content] of [['.ignore', 'ignored.txt\n'], ['ignored.txt', 'needle\n'], ['🚀.txt', 'needle\n'], ['ﬀ.txt', 'needle\n']]) {
    await fs.writeFile(`/d/${name}`, new TextEncoder().encode(content));
  }
  const values = createCommandArguments(['--json', 'needle', '/d']);
  let stdout = '', stderr = '';
  const context = {
    command: 'rg', args: values.args, argumentValues: values, cwd: '/', env: {}, fs,
    _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true,
    stdin: toByteSource(''), signal: new AbortController().signal,
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Buffer')!;
  try {
    Object.defineProperty(globalThis, 'Buffer', { configurable: true, get() { throw new Error('Buffer is unavailable'); } });
    assert.equal((await createRgCommand().execute(context)).exitCode, 0);
  } finally {
    Object.defineProperty(globalThis, 'Buffer', original);
  }
  assert.equal(stderr, '');
  const events = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.filter(event => event.type === 'begin').map(event => event.data.path.text), ['/d/ﬀ.txt', '/d/🚀.txt']);
  assert.equal(events.filter(event => event.type === 'match').length, 2);
});

test('recursive source scans use directory entries to avoid probing absent ignore files', async () => {
  const memory = createMemoryFileSystem();
  await memory.mkdir('/repo/.git', { recursive: true });
  await memory.mkdir('/repo/packages/src', { recursive: true });
  await memory.mkdir('/repo/packages/target', { recursive: true });
  await memory.writeFile('/repo/.gitignore', new TextEncoder().encode('target/\n'));
  await memory.writeFile('/repo/packages/src/.ignore', new TextEncoder().encode('skip/\n'));
  await memory.mkdir('/repo/packages/src/skip');
  await memory.writeFile('/repo/packages/src/skip/ignored.rs', new TextEncoder().encode('throw_syntax_error\n'));
  await memory.writeFile('/repo/packages/src/lib.rs', new TextEncoder().encode('fn main() {}\n'));
  await memory.writeFile('/repo/packages/src/unicode_categories.rs', new TextEncoder().encode('throw_syntax_error\n'));
  await memory.writeFile('/repo/packages/target/generated.rs', new TextEncoder().encode('throw_syntax_error\n'));
  const reads: string[] = [];
  const listings: string[] = [];
  const capabilityQueries: string[] = [];
  // Exercise the generic filesystem path, as a disk or remote adapter does.
  const fs = new Proxy(memory, {
    get(target, key) {
      if (key === 'capabilitiesFor') return async (path: string) => {
        capabilityQueries.push(path);
        return target.capabilities;
      };
      if (key === 'readFile') return async (...args: Parameters<typeof memory.readFile>) => {
        reads.push(args[0]);
        return target.readFile(...args);
      };
      if (key === 'readdir') return async (...args: Parameters<typeof memory.readdir>) => {
        listings.push(args[0]);
        return target.readdir(...args);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const values = createCommandArguments(['-n', 'throw_syntax_error', 'packages', '-g', '*.rs', '-g', '!unicode_categories.rs']);
  let stdout = '', stderr = '';
  const result = await createRgCommand().execute({
    command: 'rg', args: values.args, argumentValues: values, cwd: '/repo', env: {}, fs,
    stdin: toByteSource(''), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 1, stderr);
  assert.equal(stdout, '');
  assert.equal(stderr, '');
  assert.deepEqual(listings, ['/repo/packages', '/repo/packages/src']);
  assert.ok(!capabilityQueries.includes('/repo/packages/.gitignore'),
    'known-absent ignore files must not trigger path capability resolution');
  assert.ok(capabilityQueries.includes('/repo/packages/src/.ignore'),
    'existing ignore files still require path capability admission');
  assert.deepEqual(reads.filter(path => path.startsWith('/repo/packages/')), ['/repo/packages/src/.ignore'],
    'absent ignore files must not trigger backend reads for each visited directory');
});


test('directory discovery drops ignore rules that cannot match its subtree', async (t) => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/repo/src/deep', { recursive: true });
  await fs.writeFile('/repo/.ignore', new TextEncoder().encode('/docs/**/*.log\n/src/**/*.tmp\n'));
  await fs.writeFile('/repo/src/deep/keep.ts', new Uint8Array());
  await fs.writeFile('/repo/src/deep/café.ts', new Uint8Array());
  await fs.writeFile('/repo/src/deep/skip.tmp', new Uint8Array());
  const match = t.mock.method(Glob.prototype, 'mayMatch');
  const values = createCommandArguments(['--files', 'src']);
  let stdout = '', stderr = '';
  const result = await createRgCommand().execute({
    command: 'rg', args: values.args, argumentValues: values, cwd: '/repo', env: {}, fs,
    stdin: toByteSource(''), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stdout, 'src/deep/café.ts\nsrc/deep/keep.ts\n');
  const unrelated = match.mock.calls.filter(call => (call.this as Glob).source === '/docs/**/*.log');
  assert.deepEqual(unrelated.map(call => call.arguments[0]), ['src/deep/café.ts'],
    'only non-ASCII paths need the original rule set for engine validation');
});
