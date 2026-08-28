import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundFile } from '../executor-v5/projection.mjs';
import { requireThat } from '../executor-v4/safety.mjs';

export const profile = Object.freeze({
  name: 'JUST_BASH_3_4_2_UNAVAILABLE_BOOTSTRAP_V1',
  engine: 'just-bash', layout: 'baseline-installed',
  consumerPath: 'benchmarks/consumer-v5/consumer.mjs',
  consumerSha256: 'aa607a53a64e71658fd0c7ca39a6c5e14c311242433c0d41efbccdc15816edd1',
  files: Object.freeze([
    ['benchmarks/node_modules/just-bash/dist/bundle/index.js', 510637, '70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c'],
    ['benchmarks/node_modules/just-bash/dist/bundle/chunks/chunk-NCUTH6QL.js', 886, 'fae9347ddabceda17cfed0562a36d8dd570134e42a0d631122a6f85d7c6975f0'],
    ['benchmarks/node_modules/just-bash/dist/bundle/chunks/chunk-ZBUZKIPX.js', 35477, 'd9edb8f7a5e67c1b64a69e9b2614fe786deec2caeda3fec68f377b6e4c93dcc0'],
  ]),
});

export function authenticateBootstrap(view, parentURL, expectedParentURL, projection) {
  requireThat(view.engine === profile.engine && view.name === profile.layout && projection.baseline.version === '3.4.2', 'BOOTSTRAP_ENGINE', view.engine);
  requireThat(parentURL === expectedParentURL && typeof parentURL === 'string' && parentURL.startsWith('file:'), 'BOOTSTRAP_PARENT', parentURL);
  requireThat(view.consumerPath === profile.consumerPath, 'BOOTSTRAP_ENTRY', view.consumerPath);
  const consumer = view.files.find(entry => entry.path === view.consumerPath);
  requireThat(consumer?.sha256 === profile.consumerSha256 && consumer.bytes === 58 && consumer.mode === 0o644, 'BOOTSTRAP_CONSUMER', consumer);
  boundFile(path.join(view.root, consumer.path), consumer);
  for (const [filename, bytes, sha256] of profile.files) {
    const entry = view.files.find(item => item.path === filename);
    requireThat(entry?.sha256 === sha256 && entry.bytes === bytes && entry.mode === 0o644, 'BOOTSTRAP_SOURCE', filename);
    boundFile(path.join(view.root, filename), entry);
  }
  return { profile: profile.name, entryURL: pathToFileURL(path.join(view.root, view.consumerPath)).href, parentURL };
}

export function createQueryWindow(emit) {
  let opened = false;
  let revoked = false;
  let consumed = 0;
  let observing = false;
  const violations = [];
  const observe = value => {
    if (observing) return;
    observing = true;
    try { emit(value); } finally { observing = false; }
  };
  const deny = code => {
    revoked = true;
    violations.push({ code, consumed });
    const error = Object.assign(new Error(code), { code });
    try { observe({ kind: 'bootstrap-denied', code, consumed }); }
    catch (observer) { violations.push({ code: 'BOOTSTRAP_OBSERVER', consumed }); throw observer; }
    throw error;
  };
  const getter = function (...args) {
    if (observing) return deny('BOOTSTRAP_REENTRANT');
    if (!opened || revoked) return deny('BOOTSTRAP_REVOKED');
    if (args.length !== 1 || typeof args[0] !== 'string' || args[0] !== ['module', 'worker_threads'][consumed]) return deny('BOOTSTRAP_QUERY');
    consumed++;
    if (consumed === 2) revoked = true;
    try { observe({ kind: 'bootstrap-unavailable', query: args[0], slot: consumed, nativeDelegation: false }); }
    catch (error) { revoked = true; violations.push({ code: 'BOOTSTRAP_OBSERVER', consumed }); throw error; }
    return undefined;
  };
  return {
    getter,
    open() { if (opened || revoked) return deny('BOOTSTRAP_REOPEN'); opened = true; },
    revoke() { revoked = true; },
    snapshot() { return { profile: profile.name, opened, revoked, consumed, nativeDelegations: 0, violations: violations.map(value => ({ ...value })), callerAuthenticated: false, stockNodeCapabilities: false }; },
    qualify() { requireThat(opened && revoked && consumed === 2 && violations.length === 0, 'BOOTSTRAP_INCOMPLETE_OR_VIOLATION', { opened, revoked, consumed, violations }); },
  };
}

export function closeQueryWindow(window) {
  if (!window) return;
  window.revoke();
  window.qualify();
}

export async function importWithWindow({ host, window, load, afterRevoke = () => {} }) {
  const descriptor = Object.getOwnPropertyDescriptor(host, 'getBuiltinModule');
  requireThat(descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function' && descriptor.writable === true, 'BOOTSTRAP_DENIAL_DESCRIPTOR', null);
  let primary;
  let primaryPresent = false;
  const cleanup = [];
  let imported;
  try {
    window.open();
    Object.defineProperty(host, 'getBuiltinModule', { ...descriptor, value: window.getter });
    imported = await load();
  } catch (error) { primary = error; primaryPresent = true; }
  finally {
    window.revoke();
    try { Object.defineProperty(host, 'getBuiltinModule', descriptor); } catch (error) { cleanup.push(error); }
    try { afterRevoke(); } catch (error) { cleanup.push(error); }
  }
  if (primaryPresent) {
    if (cleanup.length) throw Object.assign(new Error('BOOTSTRAP_IMPORT_AND_CLEANUP'), { code: 'BOOTSTRAP_IMPORT_AND_CLEANUP', primaryPresent, primary, cleanup });
    throw primary;
  }
  if (cleanup.length) throw Object.assign(new Error('BOOTSTRAP_CLEANUP'), { code: 'BOOTSTRAP_CLEANUP', cleanup });
  window.qualify();
  return imported;
}
