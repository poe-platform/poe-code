import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { home, hashFile } from './auth.mjs';
import { createQueryWindow, importWithWindow } from '../../../breadth-continuation-20260828/executor-v7-r1/bootstrap.mjs';
import { installLoader } from '../../../breadth-continuation-20260828/executor-v7-r1/loader.mjs';
import { transport } from '../../../breadth-continuation-20260828/executor-v7-r1/transport.mjs';

const mode = process.argv[2];
assert.ok(['ordered', 'failed', 'caught', 'bad-mode'].includes(mode));
const filename = mode === 'bad-mode' ? 'ordered.mjs' : `${mode}.mjs`;
const root = path.join(home, 'fixtures');
const file = path.join(root, filename);
let nativeCalls = 0;
const sentinel = () => { nativeCalls++; throw new Error('NATIVE_SENTINEL_RAN'); };
const host = { getBuiltinModule: sentinel };
const events = [];
const state = { host, factoryCalls: 0, reason: Object.freeze({ syntheticReason: true }), values: [], window: createQueryWindow(event => events.push(event)) };
globalThis.__ownedSyntheticReview = state;
const loader = installLoader({ root, files: [{ path: filename, bytes: fs.statSync(file).size, mode: mode === 'bad-mode' ? 0o644 : 0o444, sha256: hashFile(file) }] }, event => events.push(event));
let imported;
let observed;
let revokedBeforeReturn = false;
try {
  imported = await importWithWindow({ host, window: state.window, load: () => import(pathToFileURL(file).href), afterRevoke: () => { revokedBeforeReturn = state.window.snapshot().revoked; assert.equal(host.getBuiltinModule, sentinel); } });
} catch (error) { observed = error; }
finally { loader.close(); delete globalThis.__ownedSyntheticReview; }
assert.equal(nativeCalls, 0);
assert.equal(revokedBeforeReturn, true);
if (mode === 'ordered') {
  assert.equal(observed, undefined);
  assert.deepEqual(state.values, [undefined, undefined]);
  assert.equal(state.firstSlot.consumed, 1);
  assert.equal(state.firstSlot.revoked, false);
  assert.equal(state.secondSlot.consumed, 2);
  assert.equal(state.secondSlot.revoked, true);
  assert.equal(imported.factory(), true);
  assert.equal(state.factoryCalls, 1);
  assert.equal(state.window.snapshot().consumed, 2);
} else {
  assert.equal(state.factoryCalls, 0);
  if (mode === 'failed') assert.equal(observed, state.reason);
  if (mode === 'caught') assert.equal(observed.code, 'BOOTSTRAP_INCOMPLETE_OR_VIOLATION');
  if (mode === 'bad-mode') assert.equal(observed.code, 'LOAD_METADATA');
}
if (state.alias) assert.throws(() => state.alias('module'), { code: 'BOOTSTRAP_REVOKED' });
transport().emit({ kind: 'final', report: { mode, nativeCalls, factoryCalls: state.factoryCalls, revokedBeforeReturn, firstSlot: state.firstSlot, secondSlot: state.secondSlot, snapshot: state.window.snapshot(), events, identityPreserved: mode !== 'failed' || observed === state.reason, loaderClosed: true } });
