import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectObjectIo781WorkerdLauncher } from './python-object-io-781.tooling.mjs';

test('official installed workerd is the portable default and explicit official path is accepted', () => {
  const binary = '/out/tooling/node_modules/@cloudflare/workerd-linux-64/bin/workerd';
  assert.deepEqual(selectObjectIo781WorkerdLauncher('/out/tooling', binary), { executable: binary, mode: 'official-installed-binary' });
  assert.equal(selectObjectIo781WorkerdLauncher('/out/tooling', binary, binary).executable, binary);
});

test('an explicit local sysroot wrapper is supported without admitting arbitrary executables', () => {
  const binary = '/out/tooling/node_modules/@cloudflare/workerd-linux-64/bin/workerd';
  assert.deepEqual(selectObjectIo781WorkerdLauncher('/out/tooling', binary, '/out/tooling/workerd-local.sh'), {
    executable: '/out/tooling/workerd-local.sh', mode: 'explicit-tooling-wrapper',
  });
  assert.throws(() => selectObjectIo781WorkerdLauncher('/out/tooling', binary, '/tmp/unverified-workerd'), /Unrecognized/);
});
