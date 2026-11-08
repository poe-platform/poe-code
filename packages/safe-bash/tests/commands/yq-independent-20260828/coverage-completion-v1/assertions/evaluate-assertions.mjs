import { Buffer } from 'node:buffer';
import catalogue from './catalogue.json' with { type: 'json' };

const inputKeys = ['schema', 'job', 'receipt', 'fragments', 'observations', 'sourceArguments', 'local'];
const captureKeys = ['stdoutHex', 'stderrHex', 'status', 'rejected', 'rejection', 'effects', 'events', 'cleanupErrors'];
const observationKeys = ['bindingId', 'recordId', 'role', 'status', 'facts', 'evidenceRefs'];
const eventKeys = {
  'iterator-acquire': ['index', 'kind', 'name'],
  'iterator-next': ['index', 'kind', 'name', 'offset'],
  'iterator-return': ['index', 'kind', 'name'],
  'fs-read': ['index', 'kind', 'operation', 'path', 'signalIsContext'],
  'unbound-fs-operation': ['index', 'kind', 'method', 'path'],
  'sink-write': ['index', 'kind', 'name', 'bytes'],
  'register-cleanup': ['index', 'kind'],
  'command-call': ['index', 'kind'],
  'command-return': ['index', 'kind', 'status'],
  'command-reject': ['index', 'kind', 'rejection'],
};

export class AssertionInputError extends Error {
  constructor(detail) {
    super(detail);
    this.name = 'AssertionInputError';
  }
}

function requireInput(condition, detail) {
  if (!condition) throw new AssertionInputError(detail);
}

function descriptors(value) {
  requireInput(value !== null && typeof value === 'object', 'OBJECT_REQUIRED');
  const keys = Reflect.ownKeys(value);
  requireInput(keys.length <= 250000, 'KEY_LIMIT');
  const result = Object.create(null);
  for (const key of keys) {
    requireInput(typeof key === 'string', 'SYMBOL_KEY');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireInput(descriptor && Object.hasOwn(descriptor, 'value'), 'ACCESSOR_OR_UNSTABLE_DESCRIPTOR');
    requireInput(descriptor.enumerable || (Array.isArray(value) && key === 'length'), 'NONENUMERABLE_FIELD');
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function exactKeys(value, keys, label) {
  requireInput(value !== null && typeof value === 'object' && !Array.isArray(value), label);
  const actual = Object.keys(value);
  requireInput(actual.length === keys.length && keys.every(key => Object.hasOwn(value, key)), label);
}

function ownData(value, budget = { nodes: 0, text: 0 }, depth = 0, ancestors = new Set()) {
  requireInput(++budget.nodes <= 250000 && depth <= 64, 'DATA_BOUND');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    requireInput(Number.isFinite(value), 'NONFINITE_NUMBER');
    return value;
  }
  if (typeof value === 'string') {
    budget.text += value.length;
    requireInput(budget.text <= 12582912, 'TEXT_BOUND');
    return value;
  }
  requireInput(typeof value === 'object' && !ancestors.has(value), 'NONDATA_OR_CYCLE');
  ancestors.add(value);
  const fields = descriptors(value);
  let output;
  if (Array.isArray(value)) {
    const length = fields.length;
    requireInput(Number.isSafeInteger(length) && length >= 0 && length <= 20000, 'ARRAY_BOUND');
    requireInput(Object.keys(fields).length === length + 1, 'ARRAY_EXTRA_OR_HOLE');
    output = [];
    for (let index = 0; index < length; index += 1) {
      requireInput(Object.hasOwn(fields, String(index)), 'ARRAY_HOLE');
      output.push(ownData(fields[index], budget, depth + 1, ancestors));
    }
  } else {
    output = Object.create(null);
    for (const key of Object.keys(fields)) output[key] = ownData(fields[key], budget, depth + 1, ancestors);
  }
  ancestors.delete(value);
  return output;
}

function equal(actual, expected) {
  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') return Object.is(actual, expected);
  if (Array.isArray(actual) !== Array.isArray(expected)) return false;
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  return actualKeys.length === expectedKeys.length && expectedKeys.every(key => Object.hasOwn(actual, key) && equal(actual[key], expected[key]));
}

function validHex(value) {
  return typeof value === 'string' && value.length <= 4194304 && /^(?:[0-9a-f]{2})*$/u.test(value);
}

function decode(hex) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(hex, 'hex')), valid: true };
  } catch (error) {
    if (!(error instanceof TypeError) || error.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA') throw error;
    return { text: null, valid: false };
  }
}

function parsedJson(text) {
  try {
    return { value: JSON.parse(text), valid: true };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { value: null, valid: false };
  }
}

function verdict(condition, detail) {
  return { status: condition ? 'MATCH' : 'CONTRADICTION', detail, evidenceRefs: [] };
}

function missing(detail) {
  return { status: 'UNOBSERVED', detail, evidenceRefs: [] };
}

function diagnosticMatches(capture, job, diagnostic) {
  const decoded = decode(capture.stderrHex);
  if (!decoded.valid) return false;
  const prefix = `yq: ${diagnostic.category}: ${diagnostic.code}`;
  if (decoded.text === `${prefix}\n`) return true;
  if (!decoded.text.startsWith(`${prefix} at `) || !decoded.text.endsWith('\n') || decoded.text.indexOf('\n') !== decoded.text.length - 1) return false;
  const location = decoded.text.slice(prefix.length + 4, -1);
  const match = /^(<stdin>|"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")(?::([1-9][0-9]*):([1-9][0-9]*))?$/u.exec(location);
  if (!match) return false;
  if (match[1] !== '<stdin>') {
    if (Buffer.byteLength(match[1]) > 256 || !job.files.some(file => file.path === JSON.parse(match[1]))) return false;
  }
  return !match[2] || ['input', 'schema', 'alias'].includes(diagnostic.category);
}

function snapshotMatches(capture, job) {
  const expected = [...job.files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return equal(capture.effects.before, expected) && equal(capture.effects.after, expected);
}

function validateCapture(capture) {
  exactKeys(capture, captureKeys, 'CAPTURE_KEYS');
  requireInput(validHex(capture.stdoutHex) && validHex(capture.stderrHex), 'CAPTURE_HEX');
  requireInput(capture.stdoutHex.length + capture.stderrHex.length <= 4194304, 'CAPTURE_BOUND');
  requireInput(capture.status === null || Number.isInteger(capture.status) && capture.status >= 0 && capture.status <= 255, 'STATUS_TYPE');
  requireInput(typeof capture.rejected === 'boolean', 'REJECTED_TYPE');
  requireInput(Array.isArray(capture.cleanupErrors) && Array.isArray(capture.events), 'CAPTURE_ARRAYS');
  exactKeys(capture.effects, ['before', 'after'], 'EFFECT_KEYS');
  for (const snapshot of [capture.effects.before, capture.effects.after]) {
    requireInput(Array.isArray(snapshot), 'SNAPSHOT_ARRAY');
    for (const file of snapshot) {
      exactKeys(file, ['path', 'hex'], 'SNAPSHOT_KEYS');
      requireInput(typeof file.path === 'string' && validHex(file.hex), 'SNAPSHOT_TYPES');
    }
  }
  for (const [index, event] of capture.events.entries()) {
    requireInput(event !== null && typeof event === 'object' && typeof event.kind === 'string', 'EVENT_TYPE');
    requireInput(Object.hasOwn(eventKeys, event.kind), 'UNKNOWN_EVENT');
    exactKeys(event, eventKeys[event.kind], 'EVENT_KEYS');
    requireInput(event.index === index, 'EVENT_SEQUENCE');
    for (const key of ['name', 'operation', 'path', 'method']) if (Object.hasOwn(event, key)) requireInput(typeof event[key] === 'string', 'EVENT_TEXT');
    for (const key of ['bytes', 'offset']) if (Object.hasOwn(event, key)) requireInput(Number.isSafeInteger(event[key]) && event[key] >= 0, 'EVENT_COUNT');
    if (event.kind === 'fs-read') requireInput(typeof event.signalIsContext === 'boolean', 'SIGNAL_FACT_TYPE');
  }
}

function primitive(fragment, capture, job) {
  const field = fragment.expectedPointer.split('/')[2];
  const expected = fragment.declaredValue;
  const reads = capture.events.filter(event => event.kind === 'fs-read');
  if (field === 'status') return verdict(capture.status === expected && capture.rejected === false && capture.rejection === null && capture.cleanupErrors.length === 0 && snapshotMatches(capture, job) && !capture.events.some(event => event.kind === 'unbound-fs-operation') && reads.every(event => event.signalIsContext) && (expected !== 0 || capture.stderrHex === ''), 'Status, rejection, cleanup, frozen snapshots, unbound operations, signals and success stderr');
  if (field === 'stdoutHex') return verdict(capture.stdoutHex === expected, 'Exact stdout hex');
  if (field === 'stdoutUtf8') return verdict(capture.stdoutHex === Buffer.from(expected, 'utf8').toString('hex'), 'Exact stdout UTF-8 bytes');
  if (field === 'reads') return verdict(equal(reads.map(event => event.path), expected), 'Exact ordered literal VFS reads');
  if (field === 'effectProfile') return verdict(reads.length === 0 && !capture.events.some(event => event.kind === 'iterator-acquire') && (expected === 'information' || capture.stdoutHex === ''), 'Frozen pre-input effects');
  if (field === 'diagnosticCode') {
    const diagnostic = catalogue.diagnostics.find(row => row.code === expected);
    return diagnostic ? verdict(diagnosticMatches(capture, job, diagnostic), 'Frozen diagnostic frame/category/code/location') : missing('Diagnostic catalogue entry unavailable');
  }
  if (field === 'documents') {
    const decoded = decode(capture.stdoutHex);
    if (!decoded.valid || !decoded.text.endsWith('\n')) return verdict(false, 'Documents require exact UTF-8 and final LF');
    if (job.argv.includes('json') && job.argv.includes('-c') && !job.argv.includes('-r')) {
      const parsed = decoded.text.slice(0, -1).split('\n').map(parsedJson);
      return verdict(parsed.every(row => row.valid) && equal(parsed.map(row => row.value), expected), 'Frozen compact JSON documents');
    }
    if (job.recordId === 'ENC-07') return verdict(capture.stdoutHex === job.expected.stdout.hex && equal(expected, ['\u0000']), 'Exact frozen JSON-compatible quoted YAML scalar; no general YAML parser/normalization');
    return missing('No sealed document decoder for this output profile');
  }
  return missing('Fragment is not an owned primitive');
}

function captureBinding(binding, capture, job) {
  const expected = binding.declaredValue;
  const predicate = binding.contract.predicate;
  if (predicate === 'stdoutBinding') {
    const key = expected === 'final#/exactInformation/version' ? 'version' : expected === 'final#/exactInformation/help' ? 'help' : null;
    return key ? verdict(capture.stdoutHex === Buffer.from(catalogue.exactInformation[key], 'utf8').toString('hex'), 'Exact inherited final-information UTF-8 reference') : missing('Unknown frozen output reference');
  }
  if (predicate === 'stdout' || predicate === 'stderr') {
    const hex = capture[`${predicate}Hex`];
    return verdict(hex === expected.hex && hex.length / 2 === expected.bytes && hex === Buffer.from(expected.utf8, 'utf8').toString('hex'), 'Exact frozen hex/UTF-8/byte-count triple');
  }
  if (predicate === 'diagnostic') return verdict(diagnosticMatches(capture, job, expected), 'Exact frozen diagnostic object and frame');
  if (predicate === 'yamlFrame') {
    const decoded = decode(capture.stdoutHex);
    return verdict(decoded.valid && capture.stdoutHex === job.expected.stdout.hex && expected.documents === 1 && expected.separators === 0 && expected.separator === '---\n' && expected.finalLf === true && decoded.text.endsWith('\n') && !decoded.text.split('\n').includes('---'), 'Exact ENC07 one-document frame, not a generic YAML semantic decoder');
  }
  if (predicate === 'scalar') {
    const decoded = decode(capture.stdoutHex);
    const parsed = decoded.valid && decoded.text.endsWith('\n') ? parsedJson(decoded.text.slice(0, -1)) : { valid: false };
    const value = parsed.value;
    return verdict(parsed.valid && typeof value === 'string' && [...value].length === 1 && value.codePointAt(0) === expected.decimal && `U+${value.codePointAt(0).toString(16).toUpperCase()}` === expected.codePoint && Buffer.from(value).toString('hex') === expected.utf8Hex && Buffer.byteLength(value) === expected.utf8Bytes && value.charCodeAt(0) === expected.high && value.charCodeAt(1) === expected.low, 'Public scalar Unicode/code-unit/UTF-8 facts only');
  }
  if (predicate === 'namespace') return verdict(snapshotMatches(capture, job) && !capture.events.some(event => event.kind === 'unbound-fs-operation'), 'Exact original file bytes and complete fixture namespace');
  if (predicate === 'stop-read') {
    const reads = capture.events.filter(event => event.kind === 'fs-read');
    return verdict(equal(reads.map(event => event.path), ['/v/a', '/v/b']) && snapshotMatches(capture, job) && capture.stdoutHex === Buffer.from(job.expected.stdoutUtf8).toString('hex') && !capture.events.some(event => event.kind === 'unbound-fs-operation'), 'No /v/c acquisition; complete prior stdout and unchanged namespace');
  }
  return missing('Unrecognized capture binding');
}

function observationBinding(binding, observation, capture) {
  let prerequisite = true;
  if (binding.recordId === 'FS-01') {
    const relevant = capture.events.filter(event => event.kind === 'fs-read' || event.kind === 'iterator-acquire' && event.name === '<stdin>');
    prerequisite = equal(relevant.map(event => event.kind === 'fs-read' ? event.path : event.name), ['/v/b', '<stdin>', '/v/a', '/v/b']) && relevant.filter(event => event.kind === 'fs-read').every(event => ['readFile', 'readStream'].includes(event.operation) && event.signalIsContext);
  }
  if (!prerequisite) return verdict(false, 'Known read/order/signal contradiction; missing host observation cannot mask it');
  if (!observation || observation.status === 'UNOBSERVED') return missing(binding.dependency);
  const expected = binding.contract.facts;
  const facts = observation.facts;
  const knownKeys = Object.keys(expected);
  let incomplete = Object.keys(facts).some(key => !knownKeys.includes(key)) || knownKeys.some(key => !Object.hasOwn(facts, key));
  let contradiction = false;
  for (const key of knownKeys) {
    if (!Object.hasOwn(facts, key)) continue;
    if (binding.contract.predicate === 'negative-zero') {
      if (expected[key] === 'boolean') contradiction ||= typeof facts[key] !== 'boolean';
      if (expected[key] === 'hex') contradiction ||= !validHex(facts[key]);
      if (expected[key] === 'nonempty-string') contradiction ||= typeof facts[key] !== 'string' || facts[key].length === 0;
    } else contradiction ||= !equal(facts[key], expected[key]);
  }
  if (binding.contract.predicate === 'negative-zero' && facts.baselinePreservesNegativeZero === true && facts.candidateNegativeZero === false) contradiction = true;
  if (contradiction) return { ...verdict(false, 'Declared observation contradicts frozen required facts'), evidenceRefs: observation.evidenceRefs };
  if (binding.contract.unavailable) incomplete = true;
  if (incomplete) return { ...missing(binding.contract.unavailable ?? 'Observation fields missing or unknown; no generic assertion waiver'), evidenceRefs: observation.evidenceRefs };
  return { ...verdict(true, 'Exact conditional observation predicate; caller must authenticate observer and evidence, not source truth or public-output inference'), evidenceRefs: observation.evidenceRefs };
}

export function evaluateAssertions(input) {
  const envelope = descriptors(input);
  exactKeys(envelope, inputKeys, 'INPUT_KEYS');
  requireInput(envelope.local === null || typeof envelope.local === 'object', 'LOCAL_CHANNEL');
  const budget = { nodes: 0, text: 0 };
  const data = Object.create(null);
  for (const key of inputKeys.filter(key => key !== 'local')) data[key] = ownData(envelope[key], budget);
  requireInput(data.schema === 1, 'SCHEMA');
  requireInput(data.job !== null && typeof data.job === 'object' && typeof data.job.id === 'string', 'JOB_TYPE');
  const job = catalogue.jobs.find(row => row.id === data.job.id);
  requireInput(job && equal(data.job, job), 'UNBOUND_OR_CHANGED_JOB');
  validateCapture(data.receipt);
  requireInput(Array.isArray(data.fragments) && Array.isArray(data.observations) && Array.isArray(data.sourceArguments), 'INPUT_ARRAYS');
  const fragments = catalogue.fragments.filter(row => row.projectionId === job.id);
  const supplied = new Map();
  for (const fragment of data.fragments) {
    requireInput(!supplied.has(fragment.id), 'DUPLICATE_FRAGMENT');
    requireInput(fragments.some(row => equal(row, fragment)), 'UNKNOWN_OR_CHANGED_FRAGMENT');
    supplied.set(fragment.id, fragment);
  }
  const observations = new Map();
  for (const observation of data.observations) {
    exactKeys(observation, observationKeys, 'OBSERVATION_KEYS');
    requireInput(observation.role === 'runtime' && ['OBSERVED', 'UNOBSERVED'].includes(observation.status), 'OBSERVATION_ROLE_STATUS');
    requireInput(observation.recordId === job.recordId && catalogue.bindings.some(row => row.bindingId === observation.bindingId && row.recordId === job.recordId && row.kind === 'observation'), 'UNBOUND_OBSERVATION');
    requireInput(!observations.has(observation.bindingId), 'DUPLICATE_OBSERVATION');
    requireInput(observation.facts !== null && typeof observation.facts === 'object' && !Array.isArray(observation.facts), 'FACTS_OBJECT');
    requireInput(Array.isArray(observation.evidenceRefs) && observation.evidenceRefs.every(ref => typeof ref === 'string' && ref.length > 0 && ref.length <= 4096), 'EVIDENCE_REFS');
    requireInput(observation.status !== 'OBSERVED' || observation.evidenceRefs.length > 0, 'OBSERVED_WITHOUT_EVIDENCE');
    observations.set(observation.bindingId, observation);
  }
  for (const argument of data.sourceArguments) requireInput(argument.role === 'source-static-counterproof', 'SOURCE_ROLE');
  const results = [];
  for (const fragment of fragments) {
    const binding = catalogue.bindings.find(row => row.bindingId === fragment.id);
    let result = binding ? binding.kind === 'capture' ? captureBinding(binding, data.receipt, job) : observationBinding(binding, observations.get(fragment.id), data.receipt) : primitive(fragment, data.receipt, job);
    if (!supplied.has(fragment.id) && result.status !== 'CONTRADICTION') result = missing('Exact original fragment not supplied');
    results.push({ bindingId: fragment.id, recordId: job.recordId, role: 'runtime', status: result.status, evidenceRefs: result.evidenceRefs, detail: result.detail });
  }
  const unbound = results.filter(row => row.status === 'UNOBSERVED').map(row => row.bindingId);
  return { schema: 1, jobId: job.id, status: results.some(row => row.status === 'CONTRADICTION') ? 'FAIL' : unbound.length > 0 ? 'INCOMPLETE' : 'PASS', results, unbound };
}
