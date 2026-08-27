export const peerVectors = [
  { id: 'positive-control', stderr: 'tree: -L must be between 1 and 256\n', semanticallyAcceptable: true },
  { id: 'irrelevant-same-line-constraint', stderr: 'tree: -L failed; width must be between 1 and 256\n', semanticallyAcceptable: false },
  { id: 'contradictory-next-line-zero-range', stderr: 'tree: -L must be positive\nvalid range: 0..256\n', semanticallyAcceptable: false },
];
export const independentPositiveVariants = [
  'level must be between 3 and 91\n',
  'tree: -L allowed range: 5-64\n',
  'tree: depth expected range: 1..8\n',
  'tree: Invalid depth, must be greater than 0.\n',
];
export const subjectAndDiagnosticNegatives = [
  ['same-line annotation with an unrelated subject', 'tree: invalid depth; width must be between 1 and 256\n'],
  ['valid first clause followed by contradictory bounds', 'tree: -L must be positive; valid range: 0..256\n'],
  ['valid first line followed by subject-bound contradictory bounds', 'tree: -L must be positive\ndepth must be between 0 and 256\n'],
  ['valid first line followed by zero allowance', 'tree: -L must be positive\n0 is allowed\n'],
  ['even consistent extra lines are outside the finite profile', 'tree: -L must be positive\nvalid range: 1..256\n'],
  ['prefix noise cannot lend relevance', 'width failed for -L: width must be between 1 and 256\n'],
  ['unrelated subject cannot follow a depth subject', 'tree: -L width must be between 1 and 256\n'],
];
