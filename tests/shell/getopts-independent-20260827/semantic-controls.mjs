const option = (name, index, value = null) => projection('option', name, index, value);
const end = (index) => projection('end', '?', index);
const projection = (kind, name, index, value = null, diagnostic = null) => ({
  kind,
  status: kind === 'end' ? 1 : 0,
  option: name,
  optind: index,
  argument: value === null ? { kind: 'unset' } : { kind: 'set', value },
  diagnostic,
});
const scan = (optstring, args, expected, reportErrors = true) => ({
  operation: 'scan', optstring, args, reportErrors, expected,
});
const index = (value) => ({ operation: 'index', value });
const repeated = (optstring, args, expectations) => expectations.map((expected) => scan(optstring, args, expected));

export const semanticControls = [
  {
    id: 'S01', category: 'cluster-attached-separate', native: 'N01',
    operations: repeated('pq:r', ['-prqVALUE', '-q', 'next', 'operand', '-p'], [
      option('p', 1), option('r', 1), option('q', 2, 'VALUE'), option('q', 4, 'next'), end(4), end(4),
    ]),
  },
  {
    id: 'S02', category: 'required-token-values', native: 'N02',
    operations: repeated('pq:', ['-q', '--', '-q', '', '-q', '-p'], [
      option('q', 3, '--'), option('q', 5, ''), option('q', 7, '-p'), end(7),
    ]),
  },
  {
    id: 'S03', category: 'unknown-inside-cluster', native: 'N03',
    operations: repeated('p', ['-pzp'], [
      option('p', 1),
      projection('unknown-option', '?', 1, null, { kind: 'unknown-option', option: 'z' }),
      option('p', 2), end(2),
    ]),
  },
  ...[false, true].flatMap((silent) => [false, true].flatMap((reportErrors) => [false, true].map((missing) => {
    const badOption = missing ? 'q' : 'z';
    const kind = missing ? 'missing-argument' : 'unknown-option';
    return {
      id: `S04-${Number(silent)}${Number(reportErrors)}${Number(missing)}`,
      category: 'error-mode-matrix', native: 'N04',
      operations: repeated(`${silent ? ':' : ''}q:`, [`-${badOption}`], [
        projection(kind, silent && missing ? ':' : '?', 2, silent ? badOption : null,
          !silent && reportErrors ? { kind, option: badOption } : null),
        end(2),
      ]).map((operation) => ({ ...operation, reportErrors })),
    };
  }))),
  {
    id: 'S05', category: 'double-dash-no-latch', native: 'N05',
    operations: repeated('pr', ['--', '-p', '--', '-r'], [end(2), option('p', 3), end(4), option('r', 5), end(5)]),
  },
  ...['-', '+', '', 'operand'].map((token, ordinal) => ({
    id: `S06-${ordinal}`, category: 'nonoption-not-consumed', native: 'N06',
    operations: repeated('p', [token, '-p'], [end(1), end(1)]),
  })),
  { id: 'S07', category: 'empty-vector', operations: repeated('p', [], [end(1), end(1)]) },
  {
    id: 'S08', category: 'duplicate-first-no-argument', native: 'N11',
    operations: repeated('pp:q:', ['-pqZ'], [option('p', 1), option('q', 2, 'Z'), end(2)]),
  },
  {
    id: 'S09', category: 'duplicate-first-required', native: 'N11',
    operations: repeated('p:pq', ['-pqq'], [option('p', 2, 'qq'), end(2)]),
  },
  {
    id: 'S10', category: 'double-colon-not-optional', native: 'N11',
    operations: repeated('q::p', ['-q', '-p'], [option('q', 3, '-p'), end(3)]),
  },
  {
    id: 'S11', category: 'digit-option',
    operations: repeated('1p', ['-1p'], [option('1', 1), option('p', 2), end(2)]),
  },
  {
    id: 'S12', category: 'explicit-reset-versus-visible-one', native: 'N07',
    operations: [
      scan('pqr', ['-pqr'], option('p', 1)), index(1),
      scan('pqr', ['-pqr'], option('p', 1)), scan('pqr', ['-pqr'], option('q', 1)),
      index(0), scan('pqr', ['-pqr'], option('p', 1)),
      index(-9), scan('pqr', ['-pqr'], option('p', 1)),
    ],
  },
  {
    id: 'S13', category: 'active-slot-versus-larger-index', native: 'N08',
    operations: [
      scan('pqrxz', ['-pqr', '-x', '-z'], option('p', 1)), index(2),
      ...repeated('pqrxz', ['-pqr', '-x', '-z'], [option('q', 2), option('r', 3), option('z', 4), end(4)]),
    ],
  },
  {
    id: 'S14', category: 'changed-vector-active-offset', native: 'N09',
    operations: [
      scan('pqrxyz', ['-pqr'], option('p', 1)),
      scan('pqrxyz', ['-xyz'], option('y', 1)),
      scan('pqrxyz', ['-pqz'], option('z', 2)),
      scan('pqrxyz', ['-pqz'], end(2)),
    ],
  },
  {
    id: 'S15', category: 'changed-vector-shorter-token', native: 'N10',
    operations: [
      scan('pqrx', ['-pqr'], option('p', 1)),
      scan('pqrx', ['-x'], option('x', 2)), scan('pqrx', ['-x'], end(2)),
    ],
  },
  {
    id: 'S16', category: 'changed-vector-empty',
    operations: [scan('pqr', ['-pqr'], option('p', 1)), scan('pqr', [], end(1))],
  },
  {
    id: 'S17', category: 'changed-optstring-active-required',
    operations: [scan('pqr', ['-pqr'], option('p', 1)), scan('pq:r', ['-pqr'], option('q', 2, 'r'))],
  },
  {
    id: 'S18', category: 'unicode-values', native: 'N12',
    operations: repeated('q:p', ['-q🧪é\n', '-q', '漢字', '-p'], [
      option('q', 2, '🧪é\n'), option('q', 4, '漢字'), option('p', 5), end(5),
    ]),
  },
  {
    id: 'S19', category: 'lone-surrogate-value-not-native',
    operations: repeated('q:', ['-q', '\ud800'], [option('q', 3, '\ud800'), end(3)]),
  },
  {
    id: 'S20', category: 'huge-safe-index-no-proportional-work',
    operations: [index(Number.MAX_SAFE_INTEGER), scan('p', ['-p'], end(2))],
  },
  {
    id: 'S21', category: 'required-bare-dash',
    operations: repeated('q:', ['-q', '-'], [option('q', 3, '-'), end(3)]),
  },
];

export const nativeControls = [
  { id: 'N01', semanticIds: ['S01'], stderr: '' },
  { id: 'N02', semanticIds: ['S02'], stderr: '' },
  { id: 'N03', semanticIds: ['S03'], stderr: 'getopts-independent: illegal option -- z\n' },
  { id: 'N04', semanticIds: semanticControls.filter((control) => control.native === 'N04').map((control) => control.id),
    stderr: 'getopts-independent: illegal option -- z\ngetopts-independent: option requires an argument -- q\n' },
  { id: 'N05', semanticIds: ['S05'], stderr: '' },
  { id: 'N06', semanticIds: ['S06-0', 'S06-1', 'S06-2', 'S06-3'], stderr: '' },
  { id: 'N07', semanticIds: ['S12'], stderr: '' },
  { id: 'N08', semanticIds: ['S13'], stderr: '' },
  { id: 'N09', semanticIds: ['S14'], stderr: '' },
  { id: 'N10', semanticIds: ['S15'], stderr: '' },
  { id: 'N11', semanticIds: ['S08', 'S09', 'S10'], stderr: '' },
  { id: 'N12', semanticIds: ['S18'], stderr: '' },
];
