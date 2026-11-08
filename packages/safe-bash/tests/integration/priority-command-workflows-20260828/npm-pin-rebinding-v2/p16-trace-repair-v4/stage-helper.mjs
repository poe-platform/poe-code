function fail(message) { throw new Error(message); }
function ownData(value, keys) {
  if (value === null || typeof value !== 'object') fail('TUPLE_OBJECT');
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) fail('EXACT_KEYS');
  for (const key of keys) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail('OWN_DATA_ONLY');
}
function strings(value) {
  if (!Array.isArray(value)) fail('ARGV_ARRAY');
  ownData(value, ['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
  for (const argument of value) if (typeof argument !== 'string') fail('ARGV_STRING');
}
function tuple(value) {
  if (value === null || typeof value !== 'object') fail('STAGE_OBJECT');
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
  if (kind !== 'result' && kind !== 'throw') fail('SETTLED_KIND');
  ownData(value, ['argv', 'stdinIsDefault', 'kind', kind === 'result' ? 'exitCode' : 'callerReasonSameObject']);
  strings(value.argv);
  if (typeof value.stdinIsDefault !== 'boolean') fail('STDIN_PROVENANCE');
  if (kind === 'result' && (!Number.isInteger(value.exitCode) || value.exitCode < 0 || value.exitCode > 255)) fail('STATUS');
  if (kind === 'throw' && value.callerReasonSameObject !== true) fail('THROWN_REASON');
  return JSON.stringify([value.argv, value.stdinIsDefault, value.kind, kind === 'result' ? value.exitCode : value.callerReasonSameObject]);
}
export function assertTraceStages(row, stages) {
  const contract = row.traceContract;
  if (!contract || contract.schema !== 'exact-stage-tuples-v1') fail('MISSING_PREDECLARED_CONTRACT');
  if (!Array.isArray(stages)) fail('STAGES_ARRAY');
  ownData(stages, ['length', ...Array.from({ length: stages.length }, (_, index) => String(index))]);
  if (stages.length !== contract.stages.length) fail('EXACT_STAGE_MULTIPLICITY');
  const expected = contract.stages.map(tuple);
  const actual = stages.map(tuple);
  const used = new Set();
  const positions = expected.map(key => {
    const position = actual.findIndex((candidate, index) => candidate === key && !used.has(index));
    if (position < 0) fail('MISSING_OR_CHANGED_STAGE');
    used.add(position);
    return position;
  });
  for (const [before, after] of contract.before) {
    if (expected.filter(key => key === expected[before]).length !== 1 || expected.filter(key => key === expected[after]).length !== 1) fail('AMBIGUOUS_ORDER_ROLE');
    if (!(positions[before] < positions[after])) fail('STAGE_PARTIAL_ORDER');
  }
  return true;
}

export function assertExactData(actual, expected) {
  if (expected === null || typeof expected !== 'object') {
    if (!Object.is(actual, expected)) fail('EXACT_DATA_VALUE');
    return true;
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) fail('EXACT_DATA_ARRAY');
  ownData(actual, Reflect.ownKeys(expected));
  for (const key of Reflect.ownKeys(expected)) assertExactData(Object.getOwnPropertyDescriptor(actual, key).value, Object.getOwnPropertyDescriptor(expected, key).value);
  return true;
}
export function assertFutureBudget(actual) {
  return assertExactData(actual, {
    schema: 'exclusive-parent-reservation-v1',
    id: 'priority-command-workflows-20260828/future-run-02',
    deadlineEpochMs: 1788026556000,
    remaining: { children: 85, workerStarts: 312, loaderThreads: 82, captureBytes: 356515840, scratchBytes: 536870912 },
  });
}
