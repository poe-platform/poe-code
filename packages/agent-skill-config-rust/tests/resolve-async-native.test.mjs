import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import {resolveSkillReferenceAsync as reference} from '@poe-code/agent-skill-config/node';
import {resolveSkillReferenceAsync as own} from '../dist/index.js';

test('async reference resolution belongs to the native package', () => {
  assert.notEqual(own, reference);
});

async function fixture(paths = [], settings = {}) {
  const backing = createMemoryFileSystem();
  for (const path of paths) await backing.mkdir(path, {recursive: true});
  if (settings.file) await backing.writeFile(settings.file, new Uint8Array());
  const events = [], controller = new AbortController();
  const fs = new Proxy(backing, {get(target, name) {
    const value = Reflect.get(target, name, target);
    if (typeof value !== 'function') return value;
    return async (...args) => {
      events.push([name, ...args]);
      await settings.call?.(name, args, controller);
      return value.apply(target, args);
    };
  }});
  return {events, controller, options: {fs, cwd: '/work', homeDir: '/home', signal: controller.signal}};
}

async function compare(ref, paths = [], settings = {}) {
  const a = await fixture(paths, settings), b = await fixture(paths, settings);
  const outcome = async (fn, f) => {
    try {return {value: await fn(ref, f.options)};}
    catch (error) {return {error: {name: error?.name, message: error?.message, code: error?.code}};}
  };
  assert.deepEqual(await outcome(own, a), await outcome(reference, b), ref);
  assert.deepEqual(a.events, b.events, ref);
}

test('async resolution preserves malformed admission, aliases and ordered search traces', async () => {
  for (const ref of ['', '.', '..', ' skill', 'skill ', 'a/b/c', 'a/', '/b', 'a\n',
    'claude/..', 'unknown/demo', 'poe-agent/demo', 'constructor/demo', 'demo',
    'CLAUDE/demo', 'claude-code/demo', 'codex/demo', 'cursor/demo', 'gemini/demo',
    'opencode/demo', 'goose/demo', 'demo\\name', '\uD800']) await compare(ref);
  for (const [agent, local, global] of [
    ['claude', '.claude/skills', '.claude/skills'],
    ['codex', '.codex/skills', '.codex/skills'],
    ['cursor', '.cursor/skills', '.cursor/skills-cursor'],
    ['gemini-cli', '.gemini/skills', '.gemini/skills'],
    ['opencode', '.opencode/skills', '.config/opencode/skills'],
    ['goose', '.agents/skills', '.agents/skills']
  ]) for (const paths of [
    [`/home/${global}/demo`], [`/work/${local}/demo`, `/home/${global}/demo`]
  ]) await compare(`${agent}/demo`, paths);
  await compare('demo', ['/work/.poe-code/skills', '/home/.poe-code/skills/demo'], {file: '/work/.poe-code/skills/demo'});
});

test('async resolution preserves provider failures and cancellation boundaries', async () => {
  for (const code of ['ENOENT', 'ENOTDIR', 'EACCES']) {
    await compare('demo', [], {call(name) {if (name === 'stat') throw Object.assign(new Error('injected'), {code});}});
  }
  for (const failed of [false, true]) {
    const reason = new Error('cancelled');
    await compare('demo', ['/work/.poe-code/skills/demo'], {call(name, args, controller) {
      if (name === 'stat') {controller.abort(reason); if (failed) throw new Error('host failure');}
    }});
  }
  for (const fn of [own, reference]) {
    const f = await fixture(), reason = new Error('already cancelled');
    f.controller.abort(reason);
    await assert.rejects(fn('', f.options), error => error === reason);
    assert.deepEqual(f.events, []);
    const noFs = {get fs() {throw new Error('must not inspect filesystem');}, cwd: '/work', homeDir: '/home'};
    assert.deepEqual(await fn('bad/name/extra', noFs), {kind: 'malformed', ref: 'bad/name/extra'});
  }
});
