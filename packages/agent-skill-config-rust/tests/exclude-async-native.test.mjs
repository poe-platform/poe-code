import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import * as reference from '@poe-code/agent-skill-config/node';
import * as own from '../dist/index.js';

function normalize(value) {
  if (typeof value === 'string' && value.includes('/exclude.') && value.endsWith('.tmp')) return value.slice(0, value.indexOf('/exclude.')) + '/exclude.ID.tmp';
  if (value instanceof Uint8Array) return Array.from(value);
  if (value instanceof AbortSignal) return {aborted: value.aborted};
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}
async function fixture(settings = {}) {
  const backing = createMemoryFileSystem(), events = [], controller = new AbortController();
  await backing.mkdir('/work/nested', {recursive: true});
  if (settings.git !== false) await backing.mkdir('/work/.git/info', {recursive: true});
  if (settings.content !== undefined) await backing.writeFile('/work/.git/info/exclude', new TextEncoder().encode(settings.content));
  await settings.setup?.(backing);
  const fs = new Proxy(backing, {get(target, name) {
    const value = Reflect.get(target, name, target);
    if (typeof value !== 'function') return value;
    return async (...args) => {
      events.push(normalize([name, ...args]));
      if (settings.partial && name === 'writeFile') await value.apply(target, args);
      await settings.call?.(name, args, controller);
      return value.apply(target, args);
    };
  }});
  async function snapshot(root = '/') {
    const result = {};
    for (const entry of await backing.readdir(root)) {
      const path = root === '/' ? root + entry.name : root + '/' + entry.name;
      const stat = await backing.lstat(path);
      if (stat.type === 'directory') Object.assign(result, await snapshot(path));
      else if (stat.type === 'symlink') result[path] = {link: await backing.readlink(path)};
      else result[normalize(path)] = new TextDecoder().decode(await backing.readFile(path));
    }
    return result;
  }
  return {events, snapshot, backing, options: {fs, cwd: '/work/nested', homeDir: '/home', signal: controller.signal}};
}
async function compare(action, settings = {}) {
  const a = await fixture(settings), b = await fixture(settings);
  const outcome = async (api, f) => {
    try {return {value: await action(api, f.options)};}
    catch (error) {return {error: {name: error?.name, message: error?.message, code: error?.code}};}
  };
  assert.deepEqual(await outcome(own, a), await outcome(reference, b));
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(await a.snapshot(), await b.snapshot());
}

test('async exclude updates are implemented by the native package', () => {
  assert.notEqual(own.appendExcludeBlockAsync, reference.appendExcludeBlockAsync);
  assert.notEqual(own.removeExcludeBlockAsync, reference.removeExcludeBlockAsync);
});
test('async excludes preserve queued ownership, incomplete markers and exact provider traces', async () => {
  for (const content of [undefined, '', 'user', 'user\r\n', '# custom:run begin\nunfinished\n']) {
    await compare(async (api, options) => {
      const ids = await Promise.all([
        api.appendExcludeBlockAsync(options, 'run', ['.claude/skills/a'], {markerPrefix: 'custom'}),
        api.appendExcludeBlockAsync(options, 'run', ['.codex/skills/b'], {markerPrefix: 'custom'})
      ]);
      await api.removeExcludeBlockAsync(options, ids[0], {markerPrefix: 'custom'});
      await api.removeExcludeBlockAsync(options, ids[1], {markerPrefix: 'custom'});
      return ids;
    }, {content});
  }
  await compare((api, options) => api.removeExcludeBlockAsync(options, 'absent'));
  await compare((api, options) => api.appendExcludeBlockAsync(options, '', [], {markerPrefix: ''}), {git: false});
});
test('async excludes search parent directories and parse gitdir files without following metadata links', async () => {
  for (const text of ['gitdir: ../metadata\n', 'gitdir: /metadata\u00A0', 'invalid', 'gitdir: ']) {
    await compare((api, options) => api.appendExcludeBlockAsync(options, 'run', ['entry']), {git: false, async setup(fs) {
      await fs.writeFile('/work/.git', new TextEncoder().encode(text));
    }});
  }
  for (const link of ['.git', '.git/info', '.git/info/exclude']) {
    await compare((api, options) => api.appendExcludeBlockAsync(options, 'run', ['entry']), {async setup(fs) {
      await fs.mkdir('/outside', {recursive: true});
      await fs.rm('/work/' + link, {recursive: true, force: true});
      await fs.symlink('/outside', '/work/' + link);
    }});
  }
});
test('async excludes validate before filesystem access but read entries again when queued work runs', async () => {
  for (const [run, prefix, entries] of [['bad\n', 'p', []], ['run', 'bad\r', []], ['run', 'p', ['bad\n']]]) {
    await compare((api, options) => api.appendExcludeBlockAsync(options, run, entries, {markerPrefix: prefix}));
  }
  await compare(async (api, options) => {
    const entries = ['initial'];
    const pending = api.appendExcludeBlockAsync(options, 'run', entries);
    entries.push('changed\nafter validation');
    return pending;
  });
  for (const late of [null, undefined, {toString() {return 'converted\nlate';}}, Symbol('late')]) {
    await compare((api, options) => {
      const entries = ['initial'];
      const pending = api.appendExcludeBlockAsync(options, 'run', entries);
      entries.push(late);
      return pending;
    });
  }
  for (const api of [own, reference]) {
    let visited = false;
    const entries = {[Symbol.iterator]() {visited = true; throw Error('must not iterate');}};
    await assert.rejects(api.appendExcludeBlockAsync({}, 'bad\n', entries), {message: 'runId must be a single line'});
    assert.equal(visited, false);
  }
});
test('async excludes preserve partial writes, rename cleanup and cleanup error precedence', async () => {
  for (const method of ['lstat', 'readFile', 'mkdir', 'writeFile', 'rename', 'rm']) {
    for (const code of ['ENOENT', 'EACCES']) {
      await compare((api, options) => api.appendExcludeBlockAsync(options, 'run', ['entry']), {content: 'user\n', call(name) {
        if (name === method) throw Object.assign(new Error('injected ' + method), {code});
      }});
    }
  }
  await compare((api, options) => api.appendExcludeBlockAsync(options, 'run', ['entry']), {partial: true, call(name) {
    if (name === 'writeFile') throw new Error('partial write');
  }});
  await compare((api, options) => api.appendExcludeBlockAsync(options, 'run', ['entry']), {call(name) {
    if (name === 'rename' || name === 'rm') throw new Error(name + ' failed');
  }});
});
test('async excludes retain cancellation timing and allow work after a failed queued operation', async () => {
  for (const operation of ['lstat', 'readFile', 'writeFile', 'rename']) {
    await compare((api, options) => api.appendExcludeBlockAsync(options, 'run', ['entry']), {call(name, args, controller) {
      if (name === operation) controller.abort(new Error('cancel ' + operation));
    }});
  }
  for (const api of [own, reference]) {
    let failed = false;
    const f = await fixture({call(name) {if (name === 'writeFile' && !failed) {failed = true; throw new Error('first write');}}});
    const first = api.appendExcludeBlockAsync(f.options, 'run', ['first']);
    const second = api.appendExcludeBlockAsync(f.options, 'run', ['second']);
    await assert.rejects(first, {message: 'first write'});
    assert.equal(await second, 'run');
    assert.match(new TextDecoder().decode(await f.backing.readFile('/work/.git/info/exclude')), /second/);
  }
});
