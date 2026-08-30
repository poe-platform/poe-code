export const bounded = { maxInputBytes: 300000, maxChunks: 2, maxChunkBytes: 300000, maxOutputBytes: 300000, maxWork: 2000000, maxRetainedBytes: 4000000 };
const publicCase = (id, args, input, limits, stdout, code = 0, classification = 'CONTROL') => ({ id, kind: 'public', args, inputBase64: Buffer.from(input).toString('base64'), limits: { ...bounded, ...limits }, expected: { stdoutBase64: Buffer.from(stdout).toString('base64'), code, classification } });
const internal = (id, pairs, limits, expected, cancel = false) => ({ id, kind: 'internal-selector', text: '"' + '""'.repeat(pairs) + '"', limits: { ...bounded, maxArgumentBytes: 200000, maxSelectorBytes: 200000, ...limits }, pairs, cancel, expected });
export const cases = [
  publicCase('SA01-numeric-low', ['select', '0000'], 'a\n', { maxWork: 35 }, '', 1),
  publicCase('SA01-numeric-witness', ['select', '0000'], 'a\n', { maxWork: 36 }, 'a\n', 0, 'CONFIRMED_IF_MATCH'),
  publicCase('SA01-numeric-high', ['select', '0000'], 'a\n', { maxWork: 48 }, 'a\n'),
  publicCase('SA01-not-index-zero', ['select', '0001'], 'a\n', { maxWork: 1000 }, '', 1),
  publicCase('SA02-header-low', ['headers', '-j'], 'a'.repeat(4096) + '\n', { maxRetainedBytes: 32959 }, '', 1),
  publicCase('SA02-header-explicit-threshold', ['headers', '-j'], 'a'.repeat(4096) + '\n', { maxRetainedBytes: 32960 }, 'a'.repeat(4096) + '\n', 0, 'CONFIRMED_IF_MATCH'),
  publicCase('SA02-header-witness', ['headers', '-j'], 'a'.repeat(4096) + '\n', { maxRetainedBytes: 33000 }, 'a'.repeat(4096) + '\n', 0, 'CONFIRMED_IF_MATCH'),
  publicCase('SA02-header-high', ['headers', '-j'], 'a'.repeat(4096) + '\n', { maxRetainedBytes: 37027 }, 'a'.repeat(4096) + '\n'),
  internal('SA03-quoted-small-control', 1, { maxWork: 10 }, { work: 10, returned: true }),
  internal('SA03-quoted-selector-guard', 65537, { maxSelectorBytes: 131075 }, { work: 131076, returned: false, limit: 'maxSelectorBytes' }),
  internal('SA03-quoted-positive', 65537, { maxWork: 600000 }, { work: 458762, returned: true }),
  internal('SA03-quoted-inflight-cancel', 65537, { maxWork: 600000 }, { cancelled: true }, true),
  publicCase('SA03-whitespace-cell-guard', ['headers', '-j'], ' '.repeat(65537) + '\n', { maxCellBytes: 65536 }, '', 1),
  publicCase('SA03-whitespace-positive', ['headers', '-j'], ' '.repeat(65537) + '\n', {}, '·'.repeat(65537) + '\n'),
];
export const obligations = [
  { id: 'SA01-repeated-signed-scans', cases: ['SA01-numeric-low', 'SA01-numeric-witness', 'SA01-numeric-high', 'SA01-not-index-zero'], implementationWork: { argvScalarScan: 10, selectorScalarScan: 4, endpointScan: 4, endpointEncodingSizing: 4, endpointEncoding: 4, inputScan: 2, rawCopy: 1, decodedCopy: 1, emittedIndex: 1, writerScan: 1, writerCopyAndLF: 2, outputBytes: 2 }, omittedLowerBound: { numericRegex: 4, leadingZeroScan: 4, bigintInput: 4 }, normativeLowerBound: 48 },
  { id: 'SA02-header-line-retention', cases: ['SA02-header-low', 'SA02-header-explicit-threshold', 'SA02-header-witness', 'SA02-header-high'], metadata: 160, bufferCapacity: 8192, persistentStrings: 16384, persistentSubtotal: 24736, earlierLargestExplicitHold: 32960, encodedLine: 4097, missingLineString: 8194, simultaneousLowerBound: 37027 },
  { id: 'SA03-yield-bound', cases: cases.filter(item => item.id.startsWith('SA03')).map(item => item.id), requiredDynamicYieldCount: 'UNPROVEN_BY_ALLOWED_API', quotedPairs: 65537, quotedLoopChargedIterations: 65538, whitespaceTrimChargedIterations: 65537, wildcard: 'STATIC_ONLY_NOT_EXECUTED' },
  { id: 'SA01-diagnostic-output-charge', cases: [], state: 'STATIC_ONLY_NOT_EXECUTED_NO_NEW_DIAGNOSTIC_POLICY' },
];
export function assertObservation(assert, spec, record) {
  assert.equal(record.id, spec.id);
  assert.equal(record.closed, true);
  assert.equal(record.naturalSettlement, true);
  if (spec.kind === 'public') {
    assert.equal(record.thrown, false);
    assert.equal(record.result.exitCode, spec.expected.code);
    assert.equal(record.stdoutBase64, spec.expected.stdoutBase64);
    assert.equal(record.fsCalls, 0);
    assert.ok(record.events.some(event => event.type === 'input-delivery'), 'actual input activation');
    if (spec.expected.code === 0) assert.equal(record.stderrBase64, '');
  } else if (spec.expected.cancelled) {
    assert.equal(record.sameReason, true);
    assert.equal(record.thrown, true);
    assert.ok(record.events.some(event => event.type === 'cancel-armed'), 'cancellation armed in flight');
    assert.ok(record.work >= 196614 && record.work < 458762, 'quoted loop completed before cancellation, encoding incomplete');
  } else {
    assert.equal(record.work, spec.expected.work);
    assert.equal(record.thrown, !spec.expected.returned);
    if (spec.expected.returned) {
      assert.equal(record.endpoint.name, '""'.repeat(spec.pairs));
      assert.equal(record.endpoint.bytesBase64, Buffer.from('""'.repeat(spec.pairs)).toString('base64'));
      assert.equal(record.endpoint.index, null);
    } else assert.equal(record.reason.limit, spec.expected.limit);
  }
}
