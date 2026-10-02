import assert from "node:assert/strict";
import { test } from "node:test";
import { Matcher } from "./matcher.js";
import { count, parse } from "./options.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { RegexSession } from "safe-bash-regex-engine/execution/portable";
import { Walker } from "./walk.js";
import type { CommandContext } from "safe-bash-contracts";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { Limits, trySyncLineBatches } from "./shared.js";

for (const external of [false, true]) {
  test(`sync line fallback preserves the due yield (external=${external})`, async () => {
    const controller = new AbortController();
    if (external) registerYieldCheckpoint(controller.signal, () => {});
    const limits = new Limits({ signal: controller.signal } as CommandContext, {});
    for (let i = 1; i < (external ? 128 : 2048); i++) assert.equal(limits.tick(), undefined);
    const state = { bytesRead: 0, bytesSearched: 0, binaryOffset: null, skipped: false };
    assert.equal(trySyncLineBatches(new TextEncoder().encode('hello\n'), limits, state, 'text', false, () => 128), undefined);
    assert.equal(state.bytesRead, 0);
    const pending = limits.tick();
    assert.ok(pending instanceof Promise, 'async fallback must still await the due checkpoint');
    const reason = new Error('cancel pending yield');
    const rejected = assert.rejects(pending, error => error === reason);
    controller.abort(reason);
    await rejected;
  });
}

for (const names of [['a', 'b'], ['.hidden', 'a', 'b']]) {
  for (const ticks of [2047, 2046, 2045]) {
    test(`sync walker defers due checkpoints: ${names.join(',')} after ${ticks} ticks`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir('/files');
      if (names[0] === '.hidden') await fs.writeFile('/files/removed', new Uint8Array());
      for (const name of names) await fs.writeFile(`/files/${name}`, new Uint8Array());
      if (names[0] === '.hidden') await fs.rm('/files/removed');
      const context = { fs, cwd: '/', signal: new AbortController().signal, _fastMemoryBackingFs: fs } as unknown as CommandContext;
      const limits = new Limits(context, {});
      const walker = new Walker(context, parse(['--files', '/files']), limits, async error => { throw error; }, {} as RegexSession);
      for (let i = 0; i < ticks; i++) assert.equal(limits.tick(), undefined);
      assert.equal(walker.walkTargetsSyncOrAsync(['/files'], false, () => true, true), null);
      const pending = limits.tick();
      assert.ok(pending instanceof Promise);
      await pending;
    });
  }
}

test('walker awaits its entry checkpoint and preserves target paths across awaited callbacks', async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/files');
  for (const name of ['a', 'b']) await fs.writeFile(`/files/${name}`, new Uint8Array());
  const context = { fs, cwd: '/', signal: new AbortController().signal, _fastMemoryBackingFs: fs } as unknown as CommandContext;
  const limits = new Limits(context, {});
  const walker = new Walker(context, parse(['--files', '/files']), limits, async error => { throw error; }, {} as RegexSession);
  for (let i = 0; i < 2047; i++) limits.tick();
  const visited: string[] = [];
  const pending = walker.walkTargetsSyncOrAsync(['/files'], false, async target => {
    const path = target.path, label = target.label, canonicalPath = target.canonicalPath;
    await Promise.resolve();
    assert.deepEqual([target.path, target.label, target.canonicalPath], [path, label, canonicalPath]);
    visited.push(path);
    return true;
  });
  assert.deepEqual(visited, []);
  await pending;
  assert.deepEqual(visited, ['/files/a', '/files/b']);
});
test("search counts reject invalid and unsafe values", () => { assert.equal(count("12", "-m"), 12); assert.throws(() => count("oops", "-m")); assert.throws(() => count("9007199254740992", "-m")); });

test("literal-only matcher admission does not compile a fallback regex", () => {
  const args = parse(["-c", "sec.*ret", "/dir"]);
  const matcher = new Matcher(args.patterns, args, {} as RegexSession, true, true);
  const state = matcher as unknown as { vm: unknown; descriptor: { patterns: readonly string[] } };
  assert.equal(matcher.literalAsciiBytes, undefined);
  assert.equal(state.vm, undefined);
  assert.deepEqual(state.descriptor.patterns, []);
});

test("literal-only matchers own their pattern bytes", () => {
  const first = parse(["-c", "first", "/dir"]);
  const second = parse(["-c", "other", "/dir"]);
  const matcher = new Matcher(first.patterns, first, {} as RegexSession, true, true);
  new Matcher(second.patterns, second, {} as RegexSession, true, true);
  assert.equal(new TextDecoder().decode(matcher.literalAsciiBytes), "first");
});

for (const sorted of [true, false]) {
  for (const syncOnly of sorted ? [true, false] : [false]) {
    for (const depth of [0, 1, 2, 3]) {
      test(`walker max depth ${depth}, sorted=${sorted}, syncOnly=${syncOnly}`, async () => {
        const fs = createMemoryFileSystem();
        for (const dir of ['/d', '/d/sub', '/d/sub/deep']) {
          await fs.mkdir(dir);
          for (const name of sorted ? ['a', 'b'] : ['b', 'a']) {
            await fs.writeFile(`${dir}/${name}`, new Uint8Array());
          }
        }
        const context = { fs, cwd: '/', signal: new AbortController().signal, _fastMemoryBackingFs: fs } as unknown as CommandContext;
        const walker = new Walker(context, parse(['--files', '--max-depth', String(depth), '/d']), new Limits(context, {}), async error => { throw error; }, {} as RegexSession);
        const visited: string[] = [];
        const result = walker.walkTargetsSyncOrAsync(['/d'], false, target => { visited.push(target.path); return true; }, syncOnly);
        assert.notEqual(result, null);
        await result;
        assert.deepEqual(visited, ['/d', '/d/sub', '/d/sub/deep'].slice(0, depth).flatMap(dir => [`${dir}/a`, `${dir}/b`]));
      });
    }
  }
}

test('walker sorts Unicode filenames by UTF-8 bytes without Buffer', async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/d');
  for (const name of ['𐀀', '\ue000', 'é', 'a']) await fs.writeFile(`/d/${name}`, new Uint8Array());
  const context = { fs, cwd: '/', signal: new AbortController().signal, _fastMemoryBackingFs: fs } as unknown as CommandContext;
  const walker = new Walker(context, parse(['--files', '/d']), new Limits(context, {}), async error => { throw error; }, {} as RegexSession);
  const visited: string[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Buffer')!;
  try {
    Object.defineProperty(globalThis, 'Buffer', { configurable: true, get() { throw new Error('Buffer is unavailable'); } });
    await walker.walkTargetsSyncOrAsync(['/d'], false, target => { visited.push(target.path); return true; });
  } finally {
    Object.defineProperty(globalThis, 'Buffer', original);
  }
  assert.deepEqual(visited, ['/d/a', '/d/é', '/d/\ue000', '/d/𐀀']);
});

for (const flags of [['-d', '2'], ['-d2'], ['--max-depth=2'], ['--maxdepth', '2']]) {
  test(`depth option spelling: ${flags.join(' ')}`, () => {
    assert.equal(parse([...flags, 'match', '/d']).maxDepth, 2);
  });
}

for (const entrypoint of ['sync', 'staged', 'async'] as const) {
  for (const removedEntry of [false, true]) {
    test(`walker uses UTF-8 ordering for UTF-16-sorted entries (${entrypoint}, removed=${removedEntry})`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir('/d');
      if (removedEntry) await fs.writeFile('/d/removed', new Uint8Array());
      for (const name of ['🚀.txt', 'ﬀ.txt']) await fs.writeFile(`/d/${name}`, new Uint8Array());
      if (removedEntry) await fs.rm('/d/removed');
      const context = { fs, cwd: '/', signal: new AbortController().signal, _fastMemoryBackingFs: fs } as unknown as CommandContext;
      const makeWalker = () => new Walker(context, parse(['--files', '/d']), new Limits(context, {}), async error => { throw error; }, {} as RegexSession);
      const visited: string[] = [];
      const visit = (target: { path: string }) => { visited.push(target.path); return true; };
      if (entrypoint === 'async') await makeWalker().walkTargets(['/d'], false, visit);
      else {
        const result = makeWalker().walkTargetsSyncOrAsync(['/d'], false, visit, entrypoint === 'sync');
        if (result === null) {
          assert.deepEqual(visited, [], 'unsorted speculative traversal must defer before emitting files');
          await makeWalker().walkTargets(['/d'], false, visit);
        } else await result;
      }
      assert.deepEqual(visited, ['/d/ﬀ.txt', '/d/🚀.txt']);
    });
  }
}
