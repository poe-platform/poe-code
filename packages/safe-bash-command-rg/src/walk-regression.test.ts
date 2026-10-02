import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";

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
