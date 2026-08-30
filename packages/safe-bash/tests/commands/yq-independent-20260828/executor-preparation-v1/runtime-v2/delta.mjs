import assert from 'node:assert/strict';

export const version = 'yq-runtime-v2-20260828';
export const candidateCommit = '35da18547ca82a67be9ca22b4adc21e3b8060780';
export const contractCommit = 'bd471ef682d768692a682d40009a874f51e3ad68';

const obligations = `
  const expected = job.expected;
  const unfulfilled = [];
  const supported = new Set(['status', 'stdoutHex', 'stdoutUtf8', 'reads', 'documents', 'diagnosticCode', 'effectProfile', 'assertions']);
  assert(expected && typeof expected === 'object' && !Array.isArray(expected), 'Malformed expectations');
  for (const key of Object.keys(expected)) {
    if (!supported.has(key)) unfulfilled.push({ path: 'expected.' + key, value: expected[key], reason: 'No assertion adapter bound' });
  }
  if (Object.hasOwn(expected, 'assertions')) {
    if (!Array.isArray(expected.assertions)) unfulfilled.push({ path: 'expected.assertions', value: expected.assertions, reason: 'Malformed assertion obligations' });
    else for (const [index, value] of expected.assertions.entries()) unfulfilled.push({ path: 'expected.assertions[' + index + ']', value, reason: 'Natural-language obligation has no executable proof binding' });
  }
  if (Object.hasOwn(expected, 'documents') && !(Array.isArray(expected.documents) && job.argv.includes('json') && job.argv.includes('-c') && !job.argv.includes('-r'))) unfulfilled.push({ path: 'expected.documents', value: expected.documents, reason: 'JSON document projection not applicable' });
  if (Object.hasOwn(expected, 'effectProfile') && !['information', 'cli-rejection', 'compile-rejection'].includes(expected.effectProfile)) unfulfilled.push({ path: 'expected.effectProfile', value: expected.effectProfile, reason: 'Unknown effect profile' });
  if (Object.hasOwn(expected, 'reads') && !Array.isArray(expected.reads)) unfulfilled.push({ path: 'expected.reads', value: expected.reads, reason: 'Malformed read obligation' });
  if (Object.hasOwn(expected, 'diagnosticCode') && (typeof expected.diagnosticCode !== 'string' || !expected.diagnosticCode)) unfulfilled.push({ path: 'expected.diagnosticCode', value: expected.diagnosticCode, reason: 'Malformed diagnostic obligation' });
  for (const key of ['stdoutHex', 'stdoutUtf8']) if (Object.hasOwn(expected, key) && typeof expected[key] !== 'string') unfulfilled.push({ path: 'expected.' + key, reason: 'Malformed byte obligation' });
  if (Object.hasOwn(job, 'missingBindings') && !Array.isArray(job.missingBindings)) unfulfilled.push({ path: 'missingBindings', reason: 'Malformed missing bindings' });
  else for (const value of job.missingBindings ?? []) unfulfilled.push({ path: 'missingBindings', value, reason: 'Frozen missing proof binding' });
  if (job.fullRecordEligibleAfterProjection === false) unfulfilled.push({ path: 'fullRecordEligibleAfterProjection', value: false, reason: 'Frozen partial record remains incomplete' });
  atomicWrite(join(evidence, 'obligations.json'), JSON.stringify({ schemaVersion: 2, status: unfulfilled.length ? 'INCOMPLETE' : 'BOUND_PROJECTION_ONLY', unfulfilled, semanticFullRecordPass: false }) + '\\n');
  assert.equal(unfulfilled.length, 0, 'UNFULFILLED_OBLIGATIONS: see obligations.json; no full-record or semantic PASS');
  assert(Number.isSafeInteger(expected.status) && expected.status >= 0 && expected.status <= 255, 'Missing or malformed status obligation');
`;

const rejectionEncoder = `export function createRejectionEncoder() {
  const scope = randomUUID();
  const objects = new WeakMap();
  const symbols = new Map();
  let nextToken = 0;
  const identity = (reason, identities) => {
    if (!identities.has(reason)) identities.set(reason, ++nextToken);
    return { scope, token: identities.get(reason) };
  };
  const describe = (read) => { try { return String(read()); } catch { return '<unprintable>'; } };
  return (reason) => {
    if (reason === undefined) return { kind: 'undefined' };
    if (reason === null) return { kind: 'null' };
    const kind = typeof reason;
    if (['string', 'boolean', 'number', 'bigint'].includes(kind)) return { kind, value: Object.is(reason, -0) ? '-0' : String(reason) };
    if (kind === 'symbol') return { kind, value: String(reason), identity: identity(reason, symbols) };
    return {
      kind, identity: identity(reason, objects),
      name: describe(() => reason.name ?? ''), message: describe(() => reason.message ?? reason),
      code: describe(() => reason.code ?? ''), stack: describe(() => reason.stack ?? ''),
    };
  };
}

export const encodeRejection = createRejectionEncoder();`;

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, 'Delta requires exactly one frozen anchor');
  return source.replace(before, () => after);
}

export function applyDelta(original) {
  const files = new Map(original);
  const change = (name, before, after) => files.set(name, Buffer.from(replaceOnce(files.get(name).toString('utf8'), before, after)));
  change('assert-capture.mjs', "  assert.equal(capture.rejected, false,", obligations + "  assert.equal(capture.rejected, false,");
  change('context.mjs', "import assert from 'node:assert/strict';", "import assert from 'node:assert/strict';\nimport { randomUUID } from 'node:crypto';");
  const context = files.get('context.mjs').toString('utf8');
  const start = context.indexOf('export function encodeRejection(reason) {');
  const end = context.indexOf('\n\nexport function createFixtureContext(job)', start);
  assert(start >= 0 && end > start, 'Frozen encoder boundaries');
  change('context.mjs', context.slice(start, end), rejectionEncoder);
  change('import-fence.mjs', "'node:stream/web']);", "'node:stream/web', 'node:timers/promises']);");
  change('authorization.mjs', '  assert.equal(authorization.contractCommit,', `  assert.equal(authorization.candidateCommit, '${candidateCommit}', 'Runtime v2 is bound only to the selected candidate');\n  assert.equal(authorization.contractCommit,`);
  return files;
}
