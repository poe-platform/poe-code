import { expect, it } from 'vitest';
import { encodeFileMetadata } from './files.js';
import { validateWire } from './wire-validation.js';

it.each(['FileMetadata', 'WireExactFileStat'])('admits exact retained link counts in %s', schema => {
 for (const nlink of [0n, 2n, 9007199254740993n]) {
  const wire = JSON.parse(JSON.stringify(encodeFileMetadata({ type: 'file', size: 0n, nlink })));
  expect(wire.nlink).toBe(nlink.toString());
  expect(() => validateWire(schema, wire)).not.toThrow();
 }
 for (const nlink of [0, '01', '-1', '9223372036854775808']) {
  expect(() => validateWire(schema, { type: 'file', size: '0', nlink })).toThrow();
 }
});
