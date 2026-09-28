import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

for (const installed of [false, true]) test(`WASM build selects stable and decodes every byte (target installed=${installed})`, () => {
  const source = readFileSync(new URL('../scripts/build-wasm.mjs', import.meta.url), 'utf8');
  const script = source.split('\n').filter(line => !line.startsWith('import ')).join('\n')
    .split('import.meta.url').join('scriptUrl');
  const calls: Array<[string, string[]]> = [];
  const written = new Map<string, string | Uint8Array>();
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  runInNewContext(script, {
    URL, scriptUrl: new URL('../scripts/build-wasm.mjs', import.meta.url).href,
    execFileSync: (command: string, args: string[], options: { encoding?: string }) => {
      calls.push([command, args]);
      if (args[0] === 'target' && args[1] === 'list') {
        assert.equal(options.encoding, 'utf8');
        return installed ? 'wasm32-unknown-unknown\r\nx86_64-unknown-linux-gnu\r\n' : 'x86_64-unknown-linux-gnu\n';
      }
      return Buffer.alloc(0);
    },
    readFileSync: () => bytes,
    writeFileSync: (url: URL, content: string | Uint8Array) => written.set(url.pathname, content)
  });
  assert.deepEqual(calls.map(([cmd, args]) => [cmd, ...args.slice(0, 4)]), [
    ['rustup', 'target', 'list', '--installed', '--toolchain'],
    ...(!installed ? [['rustup', 'target', 'add', 'wasm32-unknown-unknown', '--toolchain']] : []),
    ['rustup', 'run', 'stable', 'cargo', 'build']
  ]);
  assert.equal(calls[0]?.[1].at(-1), 'stable');
  if (!installed) assert.equal(calls[1]?.[1].at(-1), 'stable');
  const generated = [...written.values()].find(value => typeof value === 'string');
  assert.equal(typeof generated, 'string');
  const js = (generated as string).split('export ').join('').split(': Uint8Array').join('');
  const result = runInNewContext(`${js}\nwasmBytes()`, { atob, Uint8Array });
  assert.deepEqual(Buffer.from(result), bytes);
  assert.ok(!js.includes('Uint8Array.from(atob'), 'decode must avoid a callback for every WASM byte');
});
