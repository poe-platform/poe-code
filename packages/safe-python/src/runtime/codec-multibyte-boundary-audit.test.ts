import {createHash} from 'node:crypto';
import {expect, it} from 'vitest';
import {codecMultibyteBoundaryAuditCases} from './codec-multibyte-boundary-audit-cases.js';
import {PythonDecodeError} from './decode-error.js';
import {ExecutionBudget} from './execution-budget.js';
import {decodeUtf7} from './utf7.js';
import {decodeWideUnicode} from './utf-wide.js';
import reference from './__snapshots__/codec-multibyte-boundary-audit-3.14.7.json';

const cases = codecMultibyteBoundaryAuditCases();

it('pins the complete multibyte audit corpus and reference platform', () => {
  expect(reference.reference.version.startsWith('3.14.7 ')).toBe(true);
  expect(reference.reference).toMatchObject({unicode: '16.0.0', platform: 'darwin', byteorder: 'little'});
  expect(cases).toHaveLength(96000);
  expect(reference.count).toBe(cases.length);
  expect(createHash('sha256').update(JSON.stringify(cases)).digest('hex')).toBe(reference.inputSha256);
  expect(reference.blocks.map(({offset, count}) => [offset, count])).toEqual(
    Array.from({length: 192}, (_, index) => [index * 500, 500])
  );
});

// Exact code points, consumed counts and failure encoding/start/end/reason are
// hashed in bounded blocks. Unit replay uses no subprocesses or file writes.
it.each(reference.blocks)('matches multibyte boundary rows $offset + $count', ({offset, count, sha256}) => {
  const outcomes = cases.slice(offset, offset + count).map(({bytes, width, errors, final}) => {
    const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000});
    try {
      const input = Uint8Array.from(bytes);
      const decoded = width === 7
        ? decodeUtf7(input, errors, meter, final)
        : decodeWideUnicode(input, width, -1, errors, meter, final);
      return [[...decoded.text], decoded.consumed];
    } catch (error) {
      if (!(error instanceof PythonDecodeError)) throw error;
      expect([...error.object]).toEqual(bytes);
      return [error.encoding, error.start, error.end, error.reason];
    }
  });
  expect(createHash('sha256').update(JSON.stringify(outcomes)).digest('hex')).toBe(sha256);
});
