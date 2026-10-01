import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultFmtLimits, validateFmtLimits } from './contracts.js';
import { parseFmtArguments } from './arguments.js';
test('fmt omitted quotas are unlimited and individual quotas remain independent', () => {
  for (const value of Object.values(defaultFmtLimits)) assert.equal(value, Infinity);
  const path = new TextEncoder().encode('a'.repeat(65537));
  assert.equal(parseFmtArguments([path]).files.length, 1);
  assert.throws(() => parseFmtArguments([path], { limits: { ...defaultFmtLimits, argumentBytes: 65536 } }), /limit/i);
  validateFmtLimits({ ...defaultFmtLimits, outputBytes: 0 });
});

test('fmt rejects oversized widths with GNU profile diagnostics without saturating numeric input', () => {
  const encoder = new TextEncoder();
  for (const profile of ['gnu-coreutils-9.10-C-bytes', 'gnu-coreutils-8.30-C-bytes'] as const) {
    for (const width of ['2501', '1073741824', '9007199254740992', '9'.repeat(400)]) {
      const suffix = profile === 'gnu-coreutils-8.30-C-bytes' && width !== '2501'
        ? 'Value too large for defined data type' : 'Numerical result out of range';
      assert.throws(() => parseFmtArguments([encoder.encode(`--width=${width}`)], { profile }),
        { code: 'WIDTH', message: `invalid width: '${width}': ${suffix}` });
    }
  }
});
