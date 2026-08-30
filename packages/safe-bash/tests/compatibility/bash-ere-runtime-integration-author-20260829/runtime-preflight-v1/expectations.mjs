export const outputs = {
  R01: '0:<ab42>:<ab>:<42>\n', R02: '0:<aa>\n', R03: '<aa>\n<aa>\n<>\n',
  R04: '<aaa>\n<aaa>\n<>\n', R05: '<ababc>\n<abab>\n<ab>\n<c>\n',
  R06: '<aba>\n<a>\n<>\n', R07: '<>\n<>\n<>\n0\n', R08: '<>\n',
  R09: '1\n0\n', R10: '0:<a\nb>\n', R11: '1\n0\n', R12: '1\n0\n',
  R13: '0\n', R14: '0\n', R15: '<XYZ>\n', R16: '<--]>\n<--]>\n',
  R17: '<ababab>\n<ab>\n', R18: '2:<old>\n', R19: '2:<old>\n', R20: '<old>\n',
  R21: '', R22: '1\n<>\n1\n', R23: '1:<a>\n', R24: 'in:<b>\nout:<global>\n',
  R25: '0:<saved>\n', R26: '1:<>\n', R27: 'sub:<b>\nparent:<outer>\n',
  R28: '<aa>\n<a>\nlast:<a>\n', R29: '2:<>\n', R30: '2\n', R31: '2:<>\n', R32: '1:<1>\n'
};
export const diagnostic = {
  R08: 'unsupported ERE profile', R18: 'invalid ERE', R19: 'invalid ERE',
  R21: 'Unterminated conditional regular expression group', R25: 'BASH_REMATCH: readonly variable',
  R26: 'exported binding cannot be indexed', R29: 'unsupported ERE profile',
  R30: 'unsupported ERE profile', R31: 'unsupported ERE profile'
};
export const gates = {
  H02: 'Needs accepted actual-matcher in-flight gate. Holding only a parent reply proves completed-job reply delay, NOT an in-flight engine checkpoint; literal fake Worker would not discharge this ID.',
  H03: 'Exact group/node/depth/interval plus modest work/state boundary matrix needs a source-bound parameter preseal. A group33 example alone is not all grammar/logical/preallocation obligations.',
  H04: 'Needs actual integrated array ownership/snapshot/ticket observation and retirement-failure route binding. No lower-private-cap hook or injected counter accepted as public proof.',
  H05: 'Needs a transport-approved pause after target snapshot and before publication, plus actual context.invoke mutation route. No injected shell state, no post-hoc candidate-derived expected status.',
  H07: 'Malformed literal Worker role is prepared but NOT substituted. Needs separately admitted operation/id/span/cardinality/late-reply variants and nested-load witness mapping after transport60 qualification.',
  EH04: 'Needs exact registered-cleanup versus diagnostic/raw-falsy route oracle and gate/release adapter; H06 sink-only checks do not discharge cleanup/barrier precedence.',
  EH05: 'Needs source-bound exact-invoke versus derived-Promise expectation variants from N14 before executable expected statuses. No blanket assumption that all derived failures reject or map to1.'
};
export const hostWorkerCeilings = { H01: 0, H06: 4, H08: 2, EH01: 10, EH02: 3, EH03: 2 };
export function define(row) {
  const descriptor = { ...row, state: 'UNRUN', basis: 'ROOT project profile and frozen source reasoning, NOT native goldens', workerStartsMaximum: 1 };
  if (gates[row.id]) return { ...descriptor, route: 'DEFERRED_ADAPTER', gate: gates[row.id], workerStartsMaximum: 8 };
  if (row.id.startsWith('R')) return { ...descriptor, route: 'script', expected: { exitCode: row.id === 'R21' ? 2 : 0, stdout: outputs[row.id], stderr: diagnostic[row.id] ? { contains: diagnostic[row.id], qualification: 'diagnostic category/source phrase, not GNU byte equivalence' } : { exact: '' } } };
  if (row.id.startsWith('EC')) return { ...descriptor, route: 'script', expected: { exitCode: row.id === 'EC19' ? 2 : row.predictedStatus, stdout: ['EC21', 'EC22'].includes(row.id) ? 'after' : '', stderr: row.id === 'EC19' ? { contains: 'Unterminated conditional regular expression group' } : { observedCategory: 'visited invalid ERE only; literal visit-count below' } }, invalidVisits: ['EC08', 'EC09', 'EC23'].includes(row.id) ? 0 : row.id === 'EC12' ? 2 : row.id === 'EC19' ? 0 : 1 };
  return { ...descriptor, route: 'host', workerStartsMaximum: hostWorkerCeilings[row.id], qualification: row.id === 'H01' ? 'No acquisition dynamically observable; no publication after preabort is SOURCE-qualified, not an external state snapshot.' : row.id === 'H06' ? 'Sink routes only; cleanup/barrier combinations remain explicitly gated under EH04.' : row.id === 'H08' ? 'Observed root Worker/request allowances and script state; no private retained-storage/RSS inference.' : 'Finite source-profile control variants; all UNRUN' };
}
