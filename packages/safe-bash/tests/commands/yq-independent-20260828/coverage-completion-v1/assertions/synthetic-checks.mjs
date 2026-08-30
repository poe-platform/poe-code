import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { evaluateAssertions, AssertionInputError } from './evaluate-assertions.mjs';
import catalogue from './catalogue.json' with { type: 'json' };
import controls from './SYNTHETIC-CONTROLS.json' with { type: 'json' };

const output = new URL('./evidence/synthetic-v1/', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const rows = [];
let storage = 0;

function persist(name, value, append = false) {
  const text = JSON.stringify(value) + '\n';
  storage += Buffer.byteLength(text);
  if (storage > 16777216) throw new Error('SYNTHETIC_STORAGE_BOUND');
  if (append) appendFileSync(new URL(name, output), text, { mode: 0o644 });
  else writeFileSync(new URL(name, output), text, { flag: 'wx', mode: 0o644 });
}

function baseline(job) {
  const stdoutHex = job.expected.stdoutHex ?? (job.expected.stdoutUtf8 !== undefined ? Buffer.from(job.expected.stdoutUtf8).toString('hex') : job.expected.documents ? Buffer.from(job.expected.documents.map(value => JSON.stringify(value)).join('\n') + '\n').toString('hex') : '');
  const diagnostic = catalogue.diagnostics.find(row => row.code === job.expected.diagnosticCode);
  const stderrHex = diagnostic ? Buffer.from(`yq: ${diagnostic.category}: ${diagnostic.code}\n`).toString('hex') : '';
  const events = [];
  const add = (kind, detail) => events.push({ index: events.length, kind, ...detail });
  if (job.recordId === 'FS-01') {
    add('fs-read', { operation: 'readStream', path: '/v/b', signalIsContext: true });
    add('iterator-acquire', { name: '/v/b' });
    add('iterator-acquire', { name: '<stdin>' });
    add('fs-read', { operation: 'readStream', path: '/v/a', signalIsContext: true });
    add('fs-read', { operation: 'readStream', path: '/v/b', signalIsContext: true });
  } else for (const name of job.expected.reads ?? []) add('fs-read', { operation: 'readStream', path: name, signalIsContext: true });
  const receipt = { stdoutHex, stderrHex, status: job.expected.status, rejected: false, rejection: null, effects: { before: clone(job.files), after: clone(job.files) }, events, cleanupErrors: [] };
  return { schema: 1, job: clone(job), receipt, fragments: clone(catalogue.fragments.filter(row => row.projectionId === job.id)), observations: [], sourceArguments: [], local: null };
}

function observation(binding) {
  const facts = clone(binding.contract.facts);
  if (binding.contract.predicate === 'negative-zero') Object.assign(facts, { baselinePreservesNegativeZero: true, candidateNegativeZero: true, baselineStdoutHex: '2d300a', baselineEvidenceRef: 'STUB_ONLY:not-an-authorized-baseline' });
  return { bindingId: binding.bindingId, recordId: binding.recordId, role: 'runtime', status: 'OBSERVED', facts, evidenceRefs: ['STUB_ONLY:synthetic-v1/raw.jsonl'] };
}

function mutateCapture(input, binding) {
  const predicate = binding.contract.predicate;
  if (predicate === 'stderr' || predicate === 'diagnostic') input.receipt.stderrHex += '78';
  else if (predicate === 'namespace') input.receipt.effects.after[0].hex += '00';
  else if (predicate === 'stop-read') input.receipt.events.push({ index: input.receipt.events.length, kind: 'fs-read', operation: 'readStream', path: '/v/c', signalIsContext: true });
  else input.receipt.stdoutHex += '00';
}

function installControl(input, control, binding, reason) {
  if (['observed', 'contradiction', 'missing-field', 'extra-field', 'extra-and-wrong'].includes(control.kind) && binding?.kind === 'observation') input.observations.push(observation(binding));
  if (control.kind === 'contradiction') {
    if (binding.kind === 'capture') mutateCapture(input, binding);
    else if (binding.contract.predicate === 'negative-zero') input.observations[0].facts.candidateNegativeZero = false;
    else input.observations[0].facts[Object.keys(binding.contract.facts)[0]] = 'STUB_CONTRADICTION';
  }
  if (control.kind === 'missing-field') delete input.observations[0].facts[Object.keys(binding.contract.facts)[0]];
  if (control.kind === 'extra-field') input.observations[0].facts.unboundExtra = true;
  if (control.kind === 'extra-and-wrong') {
    input.observations[0].facts.unboundExtra = true;
    input.observations[0].facts[Object.keys(binding.contract.facts)[0]] = 'STUB_CONTRADICTION';
  }
  if (control.kind === 'primitive-contradiction') input.receipt.status = input.job.expected.status === 0 ? 1 : 0;
  if (control.kind === 'missing-fragment') input.fragments = input.fragments.filter(row => row.id !== binding.bindingId);
  if (control.kind === 'cross-realm') return runInNewContext('JSON.parse(text)', { text: JSON.stringify(input) }, { timeout: 1000 });
  if (control.kind === 'cross-realm-observation') {
    input.observations.push(observation(binding));
    return runInNewContext('JSON.parse(text)', { text: JSON.stringify(input) }, { timeout: 1000 });
  }
  if (control.kind === 'accessor') Object.defineProperty(input.receipt, 'status', { enumerable: true, get() { throw reason; } });
  if (control.kind === 'nonenumerable') Object.defineProperty(input.receipt, 'hidden', { value: true });
  if (control.kind === 'symbol') input.receipt[Symbol('extra')] = true;
  if (control.kind === 'undefined') input.receipt.unbound = undefined;
  if (control.kind === 'hole') { input.fragments = new Array(1); }
  if (control.kind === 'array-extra') input.fragments.extra = true;
  if (control.kind === 'duplicate-fragment') input.fragments.push(clone(input.fragments[0]));
  if (control.kind === 'unknown-fragment') input.fragments[0].id = 'SYNTHETIC_UNKNOWN';
  if (control.kind === 'changed-golden') input.job.expected.status = 253;
  if (control.kind === 'unknown-event') input.receipt.events.push({ index: 0, kind: 'unbound-event' });
  if (control.kind === 'extra-event') input.receipt.events.push({ index: 0, kind: 'command-call', extra: true });
  if (control.kind === 'wrong-event-order') input.receipt.events.push({ index: 2, kind: 'command-call' });
  if (control.kind === 'observation-without-ref') { input.observations.push(observation(binding)); input.observations[0].evidenceRefs = []; }
  if (control.kind === 'wrong-observation-id') { input.observations.push(observation(binding)); input.observations[0].bindingId = 'UNKNOWN'; }
  if (control.kind === 'source-not-runtime') input.sourceArguments.push({ role: 'source-static-counterproof', status: 'SOURCE_ARGUMENT_BOUND', bindingIds: [binding.bindingId], claims: ['STUB_NOT_TRUTH'] });
  if (control.kind === 'reason-object' || control.kind === 'reason-primitive') input.receipt = new Proxy(input.receipt, { ownKeys() { throw reason; } });
  if (control.kind === 'local-unvisited') input.local = Object.defineProperty({}, 'reason', { enumerable: true, get() { throw reason; } });
  if (control.kind === 'bad-rejection') { input.receipt.rejected = true; input.receipt.rejection = { kind: 'string', value: 'STUB' }; }
  if (control.kind === 'bad-cleanup') input.receipt.cleanupErrors.push({ kind: 'string', value: 'STUB' });
  if (control.kind === 'bad-success-stderr') input.receipt.stderrHex = '7761726e696e670a';
  if (control.kind === 'bad-namespace') input.receipt.effects.after.push({ path: '/v/extra', hex: '' });
  if (control.kind === 'bad-signal') input.receipt.events[0].signalIsContext = false;
  if (control.kind === 'bad-order') { [input.receipt.events[0].path, input.receipt.events[3].path] = [input.receipt.events[3].path, input.receipt.events[0].path]; }
  if (control.kind === 'diagnostic-location') input.receipt.stderrHex = Buffer.from('yq: schema: SCHEMA_DECIMAL_RANGE at <stdin>:1:1\n').toString('hex');
  if (control.kind === 'diagnostic-extra') input.receipt.stderrHex += Buffer.from(' warning\n').toString('hex');
  if (control.kind === 'diagnostic-wrong-source') input.receipt.stderrHex = Buffer.from('yq: schema: SCHEMA_DECIMAL_RANGE at "/unknown":1:1\n').toString('hex');
  if (control.kind === 'invalid-utf8') input.receipt.stdoutHex = 'ff0a';
  if (control.kind === 'malformed-json') input.receipt.stdoutHex = '5b0a';
  if (control.kind === 'utf22-wrong-bytes') input.receipt.stdoutHex = Buffer.from('[1,9]\n').toString('hex');
  return input;
}

mkdirSync(output, { recursive: true });
writeFileSync(new URL('raw.jsonl', output), '', { flag: 'wx', mode: 0o644 });
writeFileSync(new URL('results.jsonl', output), '', { flag: 'wx', mode: 0o644 });
persist('start.json', { schema: 1, role: 'SYNTHETIC_STUB_ONLY', controls: controls.length, productExecutions: 0, rawBeforeAssert: true, catalogueSha256: hash(readFileSync(new URL('./catalogue.json', import.meta.url))) });
for (const control of controls) {
  const binding = catalogue.bindings.find(row => row.bindingId === control.bindingId);
  const job = catalogue.jobs.find(row => row.id === (binding?.projectionId ?? control.jobId));
  const pristine = baseline(job);
  const reason = control.kind === 'reason-primitive' ? Symbol('synthetic-identity') : { exactSyntheticReason: control.id };
  persist('raw.jsonl', { id: control.id, control, raw: pristine.receipt, jobSha256: hash(JSON.stringify(job)), observationTemplate: binding?.kind === 'observation' ? observation(binding) : null, transformation: control.kind, qualification: 'STUB constructed inputs; intent persisted before non-JSON accessor/proxy transformations and assertions' }, true);
  const input = installControl(pristine, control, binding, reason);
  const nonJsonControls = ['accessor', 'nonenumerable', 'symbol', 'undefined', 'hole', 'array-extra', 'reason-object', 'reason-primitive'];
  if (!nonJsonControls.includes(control.kind)) persist('raw.jsonl', { id: control.id, phase: 'ACTUAL_INPUT_BEFORE_EVALUATION', receipt: input.receipt, observations: input.observations, sourceArguments: input.sourceArguments, fragmentIds: input.fragments.map(row => row.id), jobSha256: hash(JSON.stringify(input.job)), local: 'EXCLUDED_ACTUAL_REFERENCE_CHANNEL' }, true);
  let result;
  let thrown;
  let didThrow = false;
  try { result = evaluateAssertions(input); } catch (error) { didThrow = true; thrown = error; }
  let matched;
  if (control.expected === 'INPUT_ERROR') matched = didThrow && thrown instanceof AssertionInputError;
  else if (control.expected === 'SAME_REASON') matched = didThrow && thrown === reason;
  else if (control.expected === 'FAIL') matched = !didThrow && result.status === 'FAIL';
  else if (control.expected === 'PASS') matched = !didThrow && result.status === 'PASS';
  else matched = !didThrow && result.results.find(row => row.bindingId === control.bindingId)?.status === control.expected;
  const row = { id: control.id, kind: control.kind, expected: control.expected, matched, threw: didThrow, sameReason: didThrow && thrown === reason, inputError: didThrow && thrown instanceof AssertionInputError, result: result ?? null };
  persist('results.jsonl', row, true);
  rows.push({ id: control.id, matched });
  if (!matched) process.exitCode = 1;
}
const summary = { schema: 1, role: 'SYNTHETIC_STUB_PREDICATES_NOT_TARGET_PROOF', total: rows.length, matched: rows.filter(row => row.matched).length, failed: rows.filter(row => !row.matched), targetExecutions: 0, compilerExecutions: 0, productImports: 0, sourceOrLoadedSemanticPasses: 0, spawnedChildren: 0, status: rows.every(row => row.matched) ? 'SYNTHETIC_MATCH' : 'FAIL' };
persist('summary.json', summary);
console.log(JSON.stringify(summary));
