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
