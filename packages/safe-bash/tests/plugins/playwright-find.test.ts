import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPlaywrightSnapshot } from '../../src/playwright/find.js';
import type { PlaywrightPage } from '../../src/playwright/adapter.js';

const snapshot = '- main [ref=e1]:\n  - heading "Account" [ref=e2]\n  - list [ref=e3]:\n    - link "Profile" [ref=e4]\n    - link "Settings" [ref=e5]\n    - link "Billing" [ref=e6]\n  - button "Save" [ref=e7]';

test('find uses case-insensitive snapshot text and preserves actionable refs with surrounding context', async () => {
  assert.equal(await findPlaywrightSnapshot(snapshot, { text: 'PROFILE' }), 'Found 1 match for "PROFILE":\n\n' + snapshot);
  assert.equal(await findPlaywrightSnapshot(snapshot, { text: 'missing' }), 'No matches found for "missing".');
});

test('find regex executes in the browser realm with standard slash flags and resets global lastIndex', async () => {
  let evaluated = false;
  const page = { async evaluate(callback: (args: unknown) => unknown, args: unknown) { evaluated = true; return callback(args); } } as unknown as PlaywrightPage;
  const result = await findPlaywrightSnapshot(snapshot, { regex: '/link/gi', page });
  assert.equal(evaluated, true);
  assert.equal(result, 'Found 3 matches for /link/gi:\n\n' + snapshot);
  await assert.rejects(findPlaywrightSnapshot(snapshot, { regex: '[', page }), /regular expression|RegExp/);
});

test('find rejects missing or conflicting queries', async () => {
  await assert.rejects(findPlaywrightSnapshot(snapshot, {}), /Provide either/);
  await assert.rejects(findPlaywrightSnapshot(snapshot, { text: 'Save', regex: 'Save' }), /only one/);
});
