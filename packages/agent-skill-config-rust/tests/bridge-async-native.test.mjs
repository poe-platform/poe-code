import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import * as reference from '@poe-code/agent-skill-config/node';
import * as own from '../dist/index.js';

function normalize(value) {
  if (value instanceof Uint8Array) return Array.from(value);
  if (value instanceof AbortSignal) return {aborted: value.aborted};
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}
async function fixture(settings = {}) {
  const backing = createMemoryFileSystem(), events = [], controller = new AbortController();
  for (const [path, content] of Object.entries({
    '/work/.poe-code/skills/alpha/SKILL.md': '# Alpha',
    '/work/.poe-code/skills/alpha/assets/data.bin': new Uint8Array([0, 255, 128, 1]),
    '/home/.poe-code/skills/user/SKILL.md': '# User',
    '/work/.codex/skills/alpha/SKILL.md': '# Codex',
    '/work/.claude/skills/self/SKILL.md': '# Self',
    '/work/.git/info/exclude': 'sentinel\n'
  })) {
    await backing.mkdir(path.slice(0, path.lastIndexOf('/')), {recursive: true});
    await backing.writeFile(path, typeof content === 'string' ? new TextEncoder().encode(content) : content);
  }
  await settings.setup?.(backing);
  const fs = new Proxy(backing, {get(target, name) {
    const value = Reflect.get(target, name, target);
    if (typeof value !== 'function') return value;
    return async (...args) => {
      events.push(normalize([name, ...args]));
      await settings.before?.(name, args, backing, controller);
      const result = await value.apply(target, args);
      await settings.after?.(name, args, backing, controller);
      return result;
    };
  }});
  async function snapshot(root = '/') {
    const result = {};
    for (const entry of await backing.readdir(root)) {
      const path = root === '/' ? root + entry.name : root + '/' + entry.name;
      const stat = await backing.lstat(path);
      if (stat.type === 'directory') Object.assign(result, await snapshot(path));
      else if (stat.type === 'symlink') result[path] = {link: await backing.readlink(path)};
      else result[path] = Array.from(await backing.readFile(path));
    }
    return result;
  }
  return {events, snapshot, backing, options: {fs, cwd: '/work', homeDir: '/home', signal: controller.signal}};
}
async function compare(action, settings = {}) {
  const outputs = [], original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  try {
    for (const api of [reference, own]) {
      let id = 0;
      Object.defineProperty(globalThis.crypto, 'randomUUID', {configurable: true, value: () => `bridge-test-${id++}`});
      const f = await fixture(settings);
      let outcome;
      try {outcome = {result: await action(api, f)};}
      catch (error) {outcome = {error: {name: error?.name, message: error?.message, code: error?.code}};}
      outputs.push({outcome, events: f.events, files: await f.snapshot()});
    }
  } finally {
    if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original);
    else delete globalThis.crypto.randomUUID;
  }
  assert.deepEqual(outputs[1], outputs[0]);
  return outputs[1];
}

test('async bridge and cleanup are owned by the native package', () => {
  assert.notEqual(own.bridgeActiveSkillsAsync, reference.bridgeActiveSkillsAsync);
  assert.notEqual(own.cleanupBridgedSkillsAsync, reference.cleanupBridgedSkillsAsync);
});
test('async bridges preserve binary copies, warnings, sharing and serialized cleanup', async () => {
  const actual = await compare(async (api, f) => {
    const first = await api.bridgeActiveSkillsAsync('claude', ['alpha', 'user', 'codex/alpha', 'claude/self'], 'run', f.options);
    const second = await api.bridgeActiveSkillsAsync('claude', ['alpha', 'user'], 'run', f.options);
    const copied = await f.snapshot();
    await api.cleanupBridgedSkillsAsync(first, f.options);
    const shared = await f.snapshot();
    await api.cleanupBridgedSkillsAsync(JSON.parse(JSON.stringify(second)), f.options);
    await api.cleanupBridgedSkillsAsync(second, f.options);
    return {first, second, copied, shared};
  });
  assert.equal(actual.outcome.result.first.entries.length, 2);
  assert.equal(actual.outcome.result.second.entries.length, 2);
  assert.deepEqual(actual.outcome.result.first.warnings.map(warning => warning.kind), ['intra-batch-collision', 'self-reference']);
  assert.deepEqual(actual.outcome.result.copied['/work/.claude/skills/alpha/assets/data.bin'], [0, 255, 128, 1]);
  assert.ok(actual.outcome.result.shared['/work/.claude/skills/alpha/SKILL.md']);
  assert.equal(actual.files['/work/.claude/skills/alpha/SKILL.md'], undefined);
});
test('async bridges preserve caller changes and source changes without reusing altered claims', async () => {
  for (const changed of ['source', 'target', 'token']) {
   const actual = await compare(async (api, f) => {
    const first = await api.bridgeActiveSkillsAsync('claude', ['alpha'], 'first', f.options);
    const target = changed === 'source' ? '/work/.poe-code/skills/alpha/SKILL.md'
      : '/work/.claude/skills/alpha/' + (changed === 'token' ? '.poe-code-bridge-owner' : 'SKILL.md');
    await f.backing.writeFile(target, new TextEncoder().encode('caller change'));
    const second = await api.bridgeActiveSkillsAsync('claude', ['alpha'], 'second', f.options);
    await api.cleanupBridgedSkillsAsync(first, f.options);
    await api.cleanupBridgedSkillsAsync(second, f.options);
    return {first, second};
   });
   assert.equal(actual.outcome.result.first.entries.length, 1);
   assert.deepEqual(actual.outcome.result.second.warnings.map(warning => warning.kind), ['local-collision']);
  }
});
test('async bridges retain unsupported, resolution, symlink and collision admission', async () => {
  for (const [agent, refs] of [['unknown', ['alpha']], ['claude', ['missing']], ['claude', ['bad/name/extra']], ['claude', ['alpha', 'alpha']]]) {
    await compare((api, f) => api.bridgeActiveSkillsAsync(agent, refs, 'run', f.options));
  }
  await compare((api, f) => api.bridgeActiveSkillsAsync('claude', ['alpha'], 'run', f.options), {async setup(fs) {
    await fs.symlink('/work/.codex/skills/alpha', '/work/.poe-code/skills/alpha/link');
  }});
  for (const root of ['/work', '/home']) await compare((api, f) => api.bridgeActiveSkillsAsync('claude', ['alpha'], 'run', f.options), {async setup(fs) {
    await fs.mkdir(root + '/.claude/skills/alpha', {recursive: true});
  }});
});
test('async bridges roll back owned copies on copy, token and exclude failures', async () => {
  for (const operation of ['copyFile', 'writeToken', 'exclude']) {
   const actual = await compare((api, f) => api.bridgeActiveSkillsAsync('claude', ['alpha', 'user'], 'run', f.options), {
    before(name, args) {
      if ((operation === 'copyFile' && name === 'copyFile') ||
          (operation === 'writeToken' && name === 'writeFile' && args[0].endsWith('.poe-code-bridge-owner')) ||
          (operation === 'exclude' && name === 'writeFile' && args[0].includes('/exclude.'))) throw new Error(operation + ' failed');
    }
   });
   assert.ok(actual.outcome.error);
   assert.equal(actual.files['/work/.claude/skills/alpha/SKILL.md'], undefined);
   assert.ok(actual.files['/work/.poe-code/skills/alpha/SKILL.md']);
  }
  await compare((api, f) => api.bridgeActiveSkillsAsync('claude', ['alpha'], 'run', f.options), {after(name, args, backing, controller) {
    if (name === 'copyFile') controller.abort(new Error('cancel copy'));
  }});
  await compare((api, f) => api.bridgeActiveSkillsAsync('claude', ['alpha'], 'run', f.options), {async before(name, args, backing) {
    if (name === 'mkdir' && args[0] === '/work/.claude/skills/alpha') {
      await backing.mkdir(args[0]);
      await backing.writeFile(args[0] + '/caller', new TextEncoder().encode('keep'));
      throw Object.assign(new Error('racing target'), {code: 'EEXIST'});
    }
  }});
});
test('async cleanup protects provider identity and removes excludes before releasing copies', async () => {
  await compare(async (api, f) => {
    const manifest = await api.bridgeActiveSkillsAsync('claude', ['alpha'], 'run', f.options);
    await assert.rejects(api.cleanupBridgedSkillsAsync(manifest, {...f.options, fs: createMemoryFileSystem()}), {message: 'Bridge manifest filesystem conflicts with cleanup filesystem'});
    await f.backing.rm('/work/.git/info/exclude');
    await f.backing.symlink('/work/.poe-code/skills/alpha/SKILL.md', '/work/.git/info/exclude');
    return api.cleanupBridgedSkillsAsync(manifest, f.options);
  });
});

test('async bridge queues observe late references and retain original manifest entry identities', async () => {
  const actual = await compare(async (api, f) => {
    const refs = ['alpha'];
    const pending = api.bridgeActiveSkillsAsync('claude', refs, 'same', f.options);
    refs.push('user');
    const next = api.bridgeActiveSkillsAsync('claude', ['alpha'], 'same', f.options);
    const [first, second] = await Promise.all([pending, next]);
    const clone = JSON.parse(JSON.stringify(first));
    clone.entries = [];
    first.entries = [];
    await api.cleanupBridgedSkillsAsync(clone, f.options);
    const shared = await f.snapshot(), reads = [];
    const entry = second.entries[0], target = entry.targetPath;
    Object.defineProperty(entry, 'targetPath', {configurable: true, enumerable: true, get() {reads.push('target'); return target;}});
    await api.cleanupBridgedSkillsAsync(second, f.options);
    Object.defineProperty(entry, 'targetPath', {configurable: true, enumerable: true, value: target});
    return {shared, reads};
  });
  assert.ok(actual.outcome.result.shared['/work/.claude/skills/alpha/SKILL.md']);
  assert.equal(actual.outcome.result.shared['/work/.claude/skills/user/SKILL.md'], undefined);
  assert.equal(actual.files['/work/.claude/skills/alpha/SKILL.md'], undefined);
});
test('async bridge rollback retains foreign error identity without examining its code', async () => {
  for (const api of [reference, own]) {
    let reads = 0;
    const failure = Object.defineProperty(new Error('copy denied'), 'code', {get() {reads++; throw new Error('unexpected code read');}});
    const f = await fixture({before(name) {if (name === 'copyFile') throw failure;}});
    await assert.rejects(api.bridgeActiveSkillsAsync('claude', ['alpha'], 'run', f.options), error => error === failure);
    assert.equal(reads, 0);
    assert.equal((await f.snapshot())['/work/.claude/skills/alpha/SKILL.md'], undefined);
  }
});
