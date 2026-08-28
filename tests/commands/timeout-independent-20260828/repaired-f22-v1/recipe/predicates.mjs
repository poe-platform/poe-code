import assert from 'node:assert/strict';

export const rootMissingStdout = `consumer.ts(1,10): error TS2724: '"virtual-bash"' has no exported member named 'createTimeoutCommand'. Did you mean 'createTimeEnvCommands'?\n`;

export function assertRootMissing(result) {
  assert.equal(result.code, 2);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, rootMissingStdout);
}

export function assertImportDenied({ result, observed, trace, entry, entrySha256, target, kind, packageJson }) {
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.equal(observed.target, target);
  assert.equal(observed.caught, true);
  assert.equal(observed.productAcceptance, false);
  const loads = trace.filter(row => row.kind === 'actual-module-load');
  assert.equal(loads.length, 1);
  assert.equal(loads[0].path, entry);
  assert.equal(loads[0].sha256, entrySha256);
  const denials = trace.filter(row => row.kind === 'strict-load-allowlist-denial');
  if (kind === 'unbound-source') {
    assert.equal(observed.error.name, 'AssertionError');
    assert.equal(observed.error.code, 'ERR_ASSERTION');
    assert.equal(observed.error.message, `UNBOUND_MODULE:${target}`);
    assert.equal(observed.error.actual, false);
    assert.equal(observed.error.expected, true);
    assert.equal(observed.error.operator, '==');
    assert.deepEqual(denials, [{ kind: 'strict-load-allowlist-denial', path: target, guard: 'Object.hasOwn(config.loads,path)', beforeProductLoad: true }]);
  } else {
    assert.equal(kind, 'public-subpath');
    assert.equal(target, 'virtual-bash/commands/timeout');
    assert.equal(observed.error.code, 'ERR_PACKAGE_PATH_NOT_EXPORTED');
    assert.equal(observed.error.message, `Package subpath './commands/timeout' is not defined by "exports" in ${packageJson} imported from ${entry}`);
    assert.deepEqual(denials, []);
  }
}
