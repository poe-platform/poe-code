import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Volume, createFsFromVolume} from 'memfs';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import {discoverSkillsAsync as reference} from '@poe-code/agent-skill-config/node';
import {discoverSkillsAsync as own} from '../dist/index.js';

test('async discovery is owned by the native package', () => {
  assert.notEqual(own, reference);
});

function fixture(settings = {}) {
  const volume = Volume.fromJSON({
    '/work/skills/z/SKILL.md': 'last',
    '/work/skills/a/SKILL.md': '\uFEFFfirst',
    '/work/skills/empty/other': 'skip',
    '/work/skills/file': 'skip',
    '/work/other/a/SKILL.md': 'another',
    '/work/skills/\u{10000}/SKILL.md': 'astral',
    '/work/skills/\uE000/SKILL.md': 'bmp'
  });
  settings.setup?.(volume);
  const backing = createFsFromVolume(volume).promises;
  const events = [];
  const controller = new AbortController();
  const fs = {};
  for (const method of ['lstat', 'readdir', 'readFile']) {
    fs[method] = async (...args) => {
      events.push([method, ...args]);
      const override = await settings.call?.(method, args, controller);
      if (override !== undefined) return override;
      const value = await backing[method](...args);
      return method === 'readdir' && settings.entries
        ? value.reverse().map(name => ({name})) : value;
    };
  }
  const options = {fs, cwd: '/work', homeDir: '/home', nativePaths: true, signal: controller.signal};
  return {options, events, controller};
}

async function compare(directories, settings) {
  const a = fixture(settings), b = fixture(settings);
  const outcome = async (fn, f) => {
    try { return {value: await fn(directories, f.options)}; }
    catch (error) { return {error: {name: error?.name, message: error?.message, code: error?.code}}; }
  };
  assert.deepEqual(await outcome(own, a), await outcome(reference, b));
  assert.deepEqual(a.events, b.events);
}

test('async discovery retains UTF-16 order, duplicate paths, decoding and filesystem traces', async () => {
  for (const entries of [false, true]) {
    await compare(['missing', 'skills', 'skills/../skills', 'other'], {entries});
  }
  await compare(['skills'], {call(method, [path]) {
    if (method === 'readFile' && path.endsWith('/a/SKILL.md')) return '\uFEFFalready decoded';
  }});
});

test('async discovery rejects symlink roots and nonregular skill files at the reference stage', async () => {
  await compare(['alias'], {setup(volume) {volume.symlinkSync('/work/skills', '/work/alias');}});
  await compare(['skills'], {setup(volume) {
    volume.unlinkSync('/work/skills/a/SKILL.md');
    volume.symlinkSync('/work/skills/z/SKILL.md', '/work/skills/a/SKILL.md');
  }});
  await compare(['skills'], {setup(volume) {
    volume.unlinkSync('/work/skills/a/SKILL.md');
    volume.mkdirSync('/work/skills/a/SKILL.md');
  }});
  await compare(['skills'], {setup(volume) {volume.symlinkSync('/work/other/a', '/work/skills/link');}});
});

test('async discovery only recovers own ENOENT errors in the admitted operations', async () => {
  for (const [method, path] of [
    ['lstat', '/work/skills'], ['readdir', '/work/skills'],
    ['lstat', '/work/skills/a'], ['lstat', '/work/skills/a/SKILL.md'],
    ['readFile', '/work/skills/a/SKILL.md']
  ]) for (const code of ['ENOENT', 'ENOTDIR', 'EACCES']) {
    const error = Object.assign(new Error('injected'), {code});
    await compare(['skills', 'other'], {call(op, [target]) {if (op === method && target === path) throw error;}});
  }
  for (const error of [Object.assign(new Error('foreign'), {code: 'EACCES'}),
    {code: 'ENOENT'}, Object.assign(Object.create(Object.assign(new Error('inherited'), {code: 'ENOENT'})), {})]) {
    for (const fn of [own, reference]) {
      const f = fixture({call(method) {if (method === 'readFile') throw error;}});
      await assert.rejects(fn(['skills'], f.options), actual => actual === error);
    }
  }
});

test('async discovery preserves cancellation boundaries and closes the directory iterator', async () => {
  for (const stage of ['lstat', 'readdir', 'readFile']) {
    const reason = new Error('cancelled');
    await compare(['skills'], {call(method, args, controller) {if (method === stage) controller.abort(reason);}});
  }
  for (const fn of [own, reference]) {
    const f = fixture(), reason = new Error('early');
    f.controller.abort(reason);
    let closed = false;
    function* directories() {try {yield 'skills';} finally {closed = true;}}
    await assert.rejects(fn(directories(), f.options), error => error === reason);
    assert.equal(closed, true);
    assert.deepEqual(f.events, []);
  }
});

test('async discovery uses the injected portable filesystem capability', async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/work/skills/demo', {recursive: true});
  await fs.writeFile('/work/skills/demo/SKILL.md', new TextEncoder().encode('\uFEFF# Demo'));
  const options = {fs, cwd: '/work', homeDir: '/home'};
  assert.deepEqual(await own(['missing', 'skills', 'skills'], options), await reference(['missing', 'skills', 'skills'], options));
  assert.deepEqual(await own(['skills'], options), [{name: 'demo', file: '/work/skills/demo/SKILL.md', content: '# Demo'}]);
});
