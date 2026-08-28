import { createHash } from 'node:crypto';

export const BASE = '/Users/kjopek/Workspace/safe-bash/tests/commands/git-independent-20260828/native-bridge-v4';
export const LIMITS = Object.freeze({ workflowMs: 10000, cleanupMs: 5000, overallMs: 120000, bytes: 65536, observerCalls: 160, children: 161 });
export const TOOLS = Object.freeze({
  git: '/Applications/Xcode.app/Contents/Developer/usr/bin/git',
  sandbox: '/usr/bin/sandbox-exec',
  node: '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node',
  ps: '/bin/ps',
  inspector: '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/otool-classic',
});
export const HASHES = Object.freeze({
  git: '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9',
  sandbox: 'd1ee30dbde955aaa75c7f801fdfea4df05b10129454d7982eb6453f771436d42',
  node: '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0',
  ps: '1e46cdb824858eb32e4c85ca920ba31b4541a814a133980d8b3484f39942276c',
  inspector: '6beb1ad9c4fb7edafd59fddcb093f358f9a250bfe1db2db9f04ed1aacd523a69',
  h11: '3e624d9dd62d30a134540078a0ee3df4b8fdbd16d3f817c75f9583ba60dbcd08',
});
export const OBSERVER_ENV = Object.freeze({ PATH: '/dev/null', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' });
export const OBSERVER_ARGS = Object.freeze(['-axo', 'pid=,ppid=,pgid=,lstart=,command=']);
export const IDS = Object.freeze(['A01', 'A02', 'A03', 'A04', 'A05', 'A06']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function need(condition, message) {
  if (!condition) throw new Error(`HOLD: ${message}`);
}
export function exact(actual, expected, label = 'own-data') {
  if (expected === null || typeof expected !== 'object') {
    need(Object.is(actual, expected), label);
    return;
  }
  need(actual !== null && typeof actual === 'object' && Array.isArray(actual) === Array.isArray(expected), label);
  const expectedKeys = Reflect.ownKeys(expected), actualKeys = Reflect.ownKeys(actual);
  need(expectedKeys.length === actualKeys.length && expectedKeys.every(key => actualKeys.includes(key)), `${label}: keys`);
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(actual, key);
    need(descriptor && Object.hasOwn(descriptor, 'value'), `${label}: accessor`);
    exact(descriptor.value, expected[key], `${label}.${String(key)}`);
  }
}
export function ownValue(object, key) {
  need(object !== null && typeof object === 'object', 'own-data object');
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  need(descriptor && Object.hasOwn(descriptor, 'value'), 'own-data field before read');
  return descriptor.value;
}
export function canonical(path) {
  need(typeof path === 'string' && path.length > 1 && path.length <= 512 && /^\/[A-Za-z0-9_./-]+$/.test(path), 'literal absolute path');
  need(path.split('/').slice(1).every(part => part && part !== '.' && part !== '..'), 'canonical path components');
  need(!path.split('/').some(part => /^agents[.]md$/i.test(part)), 'filename-strict instruction exclusion, no plaintext inspection');
  return path;
}
export function ownedRoot(root) {
  canonical(root);
  need(root.startsWith(`${BASE}/owned/`), 'new owned roots only');
  need(/^(?:os-review-01|native-A0[1-6]-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(root.slice(BASE.length + 7)), 'finite root suffix');
  return root;
}
export function descriptor(path, root) {
  canonical(path); ownedRoot(root);
  need(path.startsWith(`${root}/`), 'path containment');
  return path;
}
export function failureState() {
  let hasFailure = false, primary;
  const secondary = [];
  return {
    record(reason) { if (!hasFailure) { primary = reason; hasFailure = true; } else secondary.push(reason); },
    get hasFailure() { return hasFailure; },
    get primary() { return primary; },
    get secondary() { return [...secondary]; },
    throwIfFailed() { if (hasFailure) throw primary; },
  };
}
