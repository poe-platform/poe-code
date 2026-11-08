import assert from 'node:assert/strict';
import {test} from 'node:test';
import nodePath from 'node:path';
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {posixPath} from '@poe-code/safe-fs/runtime-core';
import * as own from '../dist/index.js';
import * as reference from '@poe-code/agent-skill-config/node';

test('skill directories honor injected path implementations for every supported agent', () => {
  for (const paths of [posixPath, nodePath.win32]) for (const agent of own.supportedAgents) {
    const config = reference.getAgentConfig(agent);
    for (const scope of ['local', 'global']) {
      assert.equal(own.resolveSkillDir(config, scope, 'C:\\work', 'D:\\home', paths),
        reference.resolveSkillDir(config, scope, 'C:\\work', 'D:\\home', paths));
    }
  }
});
test('skill path methods retain getter order, receivers and lazy configuration reads', () => {
  for (const scope of ['local', 'global']) for (const target of ['~', '~./demo', '~.demo', '~\\demo', 'ordinary']) {
    const outputs = [];
    for (const api of [reference, own]) {
      const events = [];
      const paths = {
        get resolve() {events.push('resolve'); return function (...parts) {events.push(['callResolve', this === paths, ...parts]); return 'R:' + parts.join('|');};},
        get join() {events.push('join'); return function (...parts) {events.push(['callJoin', this === paths, ...parts]); return 'J:' + parts.join('|');};}
      };
      const config = {
        get globalSkillDir() {events.push('global'); return target;},
        get localSkillDir() {events.push('local'); return target;}
      };
      outputs.push({result: api.resolveSkillDir(config, scope, '/work', '/home', paths), events});
    }
    assert.deepEqual(outputs[1], outputs[0]);
  }
  for (const api of [reference, own]) {
    const fault = new Error('path accessor');
    const config = {get globalSkillDir() {throw new Error('config read too early');}};
    assert.throws(() => api.resolveSkillDir(config, 'global', '/work', '/home', {get resolve() {throw fault;}}), error => error === fault);
    assert.equal(api.resolveSkillDir({localSkillDir: 'skills', get globalSkillDir() {throw new Error('unused global');}}, 'local', '/work', '/home', nodePath.posix), '/work/skills');
  }
});
test('local skill paths do not acquire a default home directory', () => {
  const original = os.homedir;
  try {
    for (const scope of ['local', 'global']) {
      const outputs = [];
      for (const api of [reference, own]) {
        const events = [];
        os.homedir = () => {events.push('home'); return '/default-home';};
        syncBuiltinESMExports();
        const config = {get globalSkillDir() {events.push('global'); return '~/skills';}, get localSkillDir() {events.push('local'); return 'skills';}};
        outputs.push({result: api.resolveSkillDir(config, scope, '/work', undefined, nodePath.posix), events});
      }
      assert.deepEqual(outputs[1], outputs[0]);
    }
  } finally {os.homedir = original; syncBuiltinESMExports();}
});
