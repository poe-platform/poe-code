import assert from 'node:assert/strict';
import { assertRootMissing, assertImportDenied, rootMissingStdout } from './predicates.mjs';

export function focusedControls() {
  const outcomes = [];
  function check(id, expected, action) {
    let error;
    try { action(); } catch (caught) { error = { name: caught.name, code: caught.code, message: caught.message }; }
    outcomes.push({ id, expected, actual: error ? 'reject' : 'accept', error });
  }
  const validType = { code: 2, signal: null, stderr: '', stdout: rootMissingStdout };
  check('T01-exact-root-missing-export', 'accept', () => assertRootMissing(validType));
  const typeChanges = [
    ['T02-success-status', { code: 0 }],
    ['T03-signal', { signal: 'SIGTERM' }],
    ['T04-other-stderr', { stderr: 'compiler failure\n' }],
    ['T05-old-TS2305', { stdout: rootMissingStdout.replace('TS2724', 'TS2305') }],
    ['T06-missing-module', { stdout: "consumer.ts(1,10): error TS2307: Cannot find module 'virtual-bash'.\n" }],
    ['T07-other-export', { stdout: rootMissingStdout.replace('createTimeoutCommand', 'createOtherCommand') }],
    ['T08-other-location', { stdout: rootMissingStdout.replace('(1,10)', '(2,10)') }],
    ['T09-other-column', { stdout: rootMissingStdout.replace('(1,10)', '(1,11)') }],
    ['T10-other-package', { stdout: rootMissingStdout.replace('virtual-bash', 'other-package') }],
    ['T11-extra-diagnostic', { stdout: rootMissingStdout + 'error TS2688: Missing type definition.\n' }],
    ['T12-wrong-suggestion', { stdout: rootMissingStdout.replace('createTimeEnvCommands', 'createOtherCommands') }],
    ['T13-missing-LF', { stdout: rootMissingStdout.trimEnd() }],
  ];
  for (const [id, change] of typeChanges) check(id, 'reject', () => assertRootMissing({ ...validType, ...change }));
  const entry = '/owned/helper.mjs', entrySha256 = 'a'.repeat(64), target = '/external/src/index.ts';
  const source = { result: { code: 0, signal: null, stderr: '' },
    observed: { target, caught: true, productAcceptance: false, error: { name: 'AssertionError', code: 'ERR_ASSERTION', message: `UNBOUND_MODULE:${target}`, actual: false, expected: true, operator: '==' } },
    trace: [{ kind: 'actual-module-load', path: entry, sha256: entrySha256 }, { kind: 'strict-load-allowlist-denial', path: target, guard: 'Object.hasOwn(config.loads,path)', beforeProductLoad: true }],
    entry, entrySha256, target, kind: 'unbound-source' };
  check('L01-exact-unbound-source', 'accept', () => assertImportDenied(source));
  const sourceChanges = [
    ['L02-generic-assertion', value => { value.observed.error.message = 'assertion failed'; }],
    ['L03-permission-code-not-this-guard', value => { value.observed.error.code = 'ERR_ACCESS_DENIED'; }],
    ['L04-wrong-target', value => { value.observed.target = '/external/other.ts'; }],
    ['L05-no-guard-receipt', value => { value.trace.pop(); }],
    ['L06-wrong-guard', value => { value.trace[1].guard = 'other assertion'; }],
    ['L07-product-load', value => { value.trace.push({ kind: 'actual-module-load', path: target, sha256: 'b'.repeat(64) }); }],
    ['L08-helper-tamper', value => { value.trace[0].sha256 = 'b'.repeat(64); }],
    ['L09-import-success', value => { value.observed.caught = false; }],
    ['L10-child-failure', value => { value.result.code = 1; }],
  ];
  for (const [id, change] of sourceChanges) check(id, 'reject', () => { const value = structuredClone(source); change(value); assertImportDenied(value); });
  const packageJson = '/owned/node_modules/virtual-bash/package.json';
  const exported = { ...source, packageJson, kind: 'public-subpath', target: 'virtual-bash/commands/timeout',
    observed: { target: 'virtual-bash/commands/timeout', caught: true, productAcceptance: false, error: { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED', message: `Package subpath './commands/timeout' is not defined by "exports" in ${packageJson} imported from ${entry}` } }, trace: [source.trace[0]] };
  check('P01-exact-public-subpath-denial', 'accept', () => assertImportDenied(exported));
  const publicChanges = [
    ['P02-wrong-package', value => { value.observed.error.message = value.observed.error.message.replace('virtual-bash/package.json', 'other/package.json'); }],
    ['P03-generic-module-missing', value => { value.observed.error.code = 'ERR_MODULE_NOT_FOUND'; }],
    ['P04-other-subpath', value => { value.observed.error.message = value.observed.error.message.replace('./commands/timeout', './commands/other'); }],
    ['P05-unbound-instead-of-export', value => { value.trace.push(source.trace[1]); }],
  ];
  for (const [id, change] of publicChanges) check(id, 'reject', () => { const value = structuredClone(exported); change(value); assertImportDenied(value); });
  assert.equal(outcomes.length, 28);
  return outcomes;
}
