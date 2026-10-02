import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { collectStorageOriginSource, restoreStorageOriginSource } from './playwright/native-storage-sources.generated.js';

test('native storage callbacks remain self-contained serializable functions', () => {
  const realm = createContext({});
  for (const source of [collectStorageOriginSource, restoreStorageOriginSource]) {
    assert.equal(typeof runInContext('(' + source + ')', realm), 'function');
    assert.ok(source.includes('globalThis'));
  }
});
