import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as own from '../dist/safe-bash.js';
import * as reference from '../../toolcraft/dist/safe-bash.js';
import {defineGroup} from '../../toolcraft/dist/index.js';

test('Safe Bash public functions are native-owned and match the reference namespace', () => {
  assert.deepEqual(Object.keys(own).sort(), Object.keys(reference).sort());
  for (const name of Object.keys(reference)) assert.notEqual(own[name], reference[name], name);
});

test('Safe Bash defaults clone the caller configuration without reading the library', () => {
  const library = new Proxy({}, {get() {throw new Error('unused library');}});
  const config = {'users/list': {limit: 0, enabled: false, values: ['one'], nested: {value: null}}};
  const copied = own.toolcraftDefaults(library, config);
  assert.deepEqual(copied, reference.toolcraftDefaults(library, config));
  assert.notEqual(copied, config);
  assert.notEqual(copied['users/list'].values, config['users/list'].values);
});

test('Safe Bash observes Array.isArray changes made by root accessors', () => {
  const run = api => {
    const original = Array.isArray;
    let reads = 0;
    const root = new Proxy(defineGroup({name: 'tools', children: []}), {
      get(target, key, receiver) {
        if (key === 'scope') Array.isArray = value => {
          if (value === library) reads++;
          return original(value);
        };
        return Reflect.get(target, key, receiver);
      }
    });
    const library = [root];
    try {api.createToolcraftCommandExecutor(library);return reads;}
    finally {Array.isArray = original;}
  };
  const expected = run(reference);
  assert.equal(expected, 1);
  assert.equal(run(own), expected);
});
