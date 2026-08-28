import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function smallTarget(name) {
  return { maxArgs: 6, maxArgumentBytes: 16, maxInputFiles: 3, maxInputBytes: 1031, maxChunks: 4, maxChunkBytes: 33,
    maxRecordBytes: 19, maxCellBytes: 13, maxColumns: 4, maxRecords: 4, maxSelectorBytes: 11, maxSelectorNodes: 6,
    maxSelectorDepth: 2, maxSelectedColumns: 3, maxLastRows: 3, maxWork: 17, maxOutputBytes: 12, maxRetainedBytes: 19 }[name];
}

export class Accounting {
  constructor(limits) { this.limits = limits; this.total = {}; this.live = new Map(); this.peak = 0; this.events = []; }
  charge(name, amount, phase) {
    assert.ok(Number.isSafeInteger(amount) && amount >= 0);
    const next = (this.total[name] ?? 0) + amount;
    assert.ok(Number.isSafeInteger(next));
    if (next > (this.limits[name] ?? Infinity)) throw new RangeError(`${name} limit exceeded`);
    this.total[name] = next; this.events.push({ name, amount, phase });
  }
  allocate(id, capacity, kind = 'bytes') {
    assert.ok(!this.live.has(id));
    const multiplier = { bytes: 1, utf16: 2, indices: 8, node: 32, span: 32, ring: 32 }[kind];
    assert.ok(multiplier && Number.isSafeInteger(capacity) && capacity >= 0);
    const amount = multiplier * capacity;
    this.charge('maxRetainedBytes', amount, `allocate:${id}`);
    this.live.set(id, amount); this.peak = Math.max(this.peak, this.total.maxRetainedBytes);
  }
  release(id) {
    assert.ok(this.live.has(id), 'release actual live allocation only');
    this.total.maxRetainedBytes -= this.live.get(id); this.live.delete(id);
  }
  work(kind, amount, phase) {
    assert.ok(['inspect', 'compare', 'index', 'copy', 'decode', 'encode', 'output'].includes(kind));
    this.charge('maxWork', amount, `${phase}:${kind}`);
  }
}

export function digestSink(limit = Number.MAX_SAFE_INTEGER) {
  const hash = createHash('sha256');
  let total = 0;
  let finished = false;
  return {
    async write(chunk) {
      assert.ok(!finished && chunk instanceof Uint8Array);
      assert.ok(chunk.byteLength <= limit - total, 'reserve output before publication');
      hash.update(chunk); total += chunk.byteLength;
    },
    finish() { assert.ok(!finished); finished = true; return { bytes: total, sha256: hash.digest('hex') }; },
  };
}

async function* repeated(total, pattern, chunkSize = 65536) {
  assert.ok(Number.isSafeInteger(total) && total >= 0);
  for (let offset = 0; offset < total;) {
    const count = Math.min(chunkSize, total - offset);
    const chunk = new Uint8Array(count);
    for (let index = 0; index < count; index++) chunk[index] = pattern[(offset + index) % pattern.length];
    offset += count; yield chunk;
  }
}

async function* append(stream, suffix) { yield* stream; yield Buffer.from(suffix); }
const ascii = text => Buffer.from(text);

export function selectorStructure(clauses, complement = false) {
  const ledger = { clauses: clauses.length, endpoints: 0, occurrences: 0, complement: Number(complement) };
  for (const clause of clauses) {
    ledger.endpoints += clause.endpoints;
    ledger.occurrences += clause.occurrences ?? 0;
  }
  return { ...ledger, nodes: Object.values(ledger).reduce((sum, amount) => sum + amount, 0) };
}

export function generator(row, target, variant = 'plain') {
  assert.ok(Number.isSafeInteger(target) && target > 0);
  const spec = { name: row.name, target, defaultValue: row.defaultValue, hardCeiling: row.hardCeiling, unit: row.unit,
    configuredLimit: row.defaultValue,
    frozenRecipe: row.recipe, variant, scale: 'PARAMETERIZED_NOT_DEFAULT_SCALE_EVIDENCE',
    reachability: 'ATTAINABLE_SUBJECT_TO_DISCLOSED_OTHER_CAPS', dependencies: [], argv: ['count'], files: [],
    input: () => repeated(0, [0]), independent: {}, events: [] };
  switch (row.name) {
    case 'maxArgs': {
      if (target < 3 || target - 2 > 256) { spec.reachability = 'NOT_REACHABLE_INPUT_FILE_CARDINALITY'; break; }
      spec.argv = ['headers', '-j', ...Array.from({ length: target - 2 }, (_, index) => `f${index}.csv`)];
      spec.files = spec.argv.slice(2).map(name => ({ name, utf8: 'h\n' }));
      spec.independent.args = spec.argv.length; spec.dependencies = ['maxInputFiles']; break;
    }
    case 'maxArgumentBytes':
    case 'maxSelectorBytes': {
      const length = target - (row.name === 'maxArgumentBytes' ? 6 : 0);
      if (length < 1 || length > 262144) { spec.reachability = 'NOT_REACHABLE_SELECTOR_BYTES'; break; }
      spec.argv = ['select', 'a'.repeat(length)]; spec.input = () => append(repeated(length, [97]), '\n');
      spec.independent.argumentBytes = 6 + length; spec.independent.selectorBytes = length;
      spec.dependencies = ['maxArgumentBytes', 'maxSelectorBytes', 'maxRecordBytes', 'maxCellBytes']; break;
    }
    case 'maxInputFiles':
      spec.argv = ['headers', '-j', ...Array.from({ length: target }, (_, index) => `f${index}.csv`)];
      spec.files = spec.argv.slice(2).map(name => ({ name, utf8: 'h\n' })); spec.independent.inputFiles = target; break;
    case 'maxInputBytes': {
      const pattern = new Uint8Array(1024).fill(97); pattern[1023] = 10;
      spec.input = () => repeated(target, pattern); spec.independent.inputBytes = target; break;
    }
    case 'maxChunks':
      spec.input = async function* () { for (let index = 1; index < target; index++) yield new Uint8Array(); yield ascii('a\n'); };
      spec.independent.chunks = target; spec.independent.inputBytes = 2; spec.expectedStdout = '0\n'; break;
    case 'maxChunkBytes':
      spec.input = () => repeated(target, ascii('0123456789012345\n'), target);
      spec.independent.chunkBytes = target; spec.dependencies = ['maxInputBytes', 'maxWork', 'maxRecords']; break;
    case 'maxRecordBytes':
      spec.input = () => append(repeated(target, ascii(`${'a'.repeat(Math.min(Math.max(1023, Math.ceil(target / 16000)), target))},`)), '\n');
      spec.independent.recordBytes = target; spec.independent.inputBytes = target + 1;
      spec.dependencies = ['maxColumns', 'maxCellBytes']; break;
    case 'maxCellBytes':
      if (variant === 'quoted') {
        if (target < 2) { spec.reachability = 'NOT_REACHABLE_QUOTE_OVERHEAD'; break; }
        spec.input = async function* () { yield ascii('"'); yield* repeated(target - 2, [97]); yield ascii('"\n'); };
      } else if (variant === 'doubled') {
        if (target < 4) { spec.reachability = 'NOT_REACHABLE_DOUBLED_QUOTE_OVERHEAD'; break; }
        spec.input = async function* () { yield ascii('"""'); yield* repeated(target - 4, [97]); yield ascii('"\n'); };
      } else spec.input = () => append(repeated(target, [97]), '\n');
      spec.independent.cellBytes = target; spec.independent.inputBytes = target + 1; break;
    case 'maxColumns':
      spec.input = () => append(repeated(target * 2 - (variant === 'trailing' ? 2 : 1), ascii('a,')), '\n');
      spec.independent.columns = target; break;
    case 'maxRecords':
      spec.input = async function* () { yield ascii('h\n'); yield* repeated((target - 1) * 2, ascii('x\n')); };
      spec.independent.records = target; spec.expectedStdout = `${target - 1}\n`; break;
    case 'maxSelectorNodes': {
      const occurrence = variant === 'occurrence';
      const complement = variant === 'complement';
      const cost = occurrence ? 3 : 2;
      const count = (target - Number(complement)) / cost;
      if (!Number.isInteger(count) || count < 1 || count > 65536) { spec.reachability = 'NOT_REACHABLE_THIS_FROZEN_STRUCTURE'; break; }
      spec.argv = ['select', `${complement ? '!' : ''}${Array(count).fill(occurrence ? 'a[0]' : '0').join(',')}`];
      spec.input = () => repeated(4, ascii('a\nx\n'));
      spec.independent.structure = selectorStructure(Array.from({ length: count }, () => ({ endpoints: 1, occurrences: Number(occurrence) })), complement);
      spec.dependencies = ['maxSelectorBytes', 'maxSelectedColumns', 'SOURCE_AUDIT_NODE_ALLOCATION_BINDING']; break;
    }
    case 'maxSelectorDepth':
      spec.argv = ['select', '0']; spec.input = () => repeated(4, ascii('a\nx\n'));
      spec.independent.depth = 2;
      if (target !== 2) spec.reachability = 'NOT_REACHABLE_NO_INVENTED_DEPTH_3_GRAMMAR'; break;
    case 'maxSelectedColumns':
      if (target * 2 > 65536) { spec.reachability = 'NOT_REACHABLE_NODE_CAP_FOR_REPEAT_LIST'; break; }
      spec.argv = ['select', Array(target).fill('0').join(',')]; spec.input = () => repeated(4, ascii('a\nx\n'));
      spec.independent.selectedColumns = target; spec.independent.outputBytes = target * 4;
      spec.dependencies = ['maxSelectorBytes', 'maxSelectorNodes']; break;
    case 'maxLastRows':
      spec.argv = ['slice', '-L', String(target)];
      spec.input = async function* () { yield ascii('h\n'); yield* repeated(target * 2, ascii('x\n')); };
      spec.independent.requestedLastRows = target; spec.independent.ringOccupancy = target; break;
    case 'maxWork': {
      const first = Math.floor(target / 3);
      spec.events = [{ kind: 'inspect', amount: first, phase: 'scan' }, { kind: 'compare', amount: first, phase: 'resolve' },
        { kind: 'copy', amount: target - first * 2, phase: 'serialize' }];
      spec.independent.work = target; spec.dependencies = ['SOURCE_AUDIT_EACH_INSPECTION_COPY_INDEX_DECODE_ENCODE_OUTPUT']; break;
    }
    case 'maxOutputBytes': {
      if (target < 4 || target % 2) { spec.reachability = 'NOT_REACHABLE_THIS_REPEAT_SERIALIZATION'; break; }
      let columns = Math.min(256, Math.floor(target / 4));
      while (target % (columns * 2)) columns--;
      const records = target / (columns * 2);
      if (records > 16000000) { spec.reachability = 'NOT_REACHABLE_RECORD_HARD_CAP'; break; }
      spec.argv = ['select', Array(columns).fill('0').join(',')];
      spec.input = async function* () { yield ascii('a\n'); yield* repeated((records - 1) * 2, ascii('x\n')); };
      spec.output = async function* () {
        yield ascii(`${Array(columns).fill('a').join(',')}\n`);
        yield* repeated((records - 1) * columns * 2, ascii(`${Array(columns).fill('x').join(',')}\n`));
      };
      spec.independent.outputBytes = target; spec.independent.outputRecords = records; spec.independent.outputColumns = columns;
      spec.dependencies = ['maxSelectorBytes', 'maxSelectorNodes', 'maxSelectedColumns', 'maxRecords', 'maxInputBytes', 'maxWork', 'maxRetainedBytes', 'parentOutput']; break;
    }
    case 'maxRetainedBytes':
      spec.events = [{ op: 'allocate', id: 'header', kind: 'bytes', capacity: 1 },
        { op: 'allocate', id: 'segments', kind: 'bytes', capacity: Math.floor((target - 1) / 2) },
        { op: 'allocate', id: 'assembly', kind: 'bytes', capacity: target - 1 - Math.floor((target - 1) / 2) },
        { op: 'release', id: 'segments' }, { op: 'release', id: 'assembly' }, { op: 'release', id: 'header' }];
      spec.independent.peakCapacity = target; spec.dependencies = ['SOURCE_AUDIT_CAPACITY_AND_LIFETIME_BINDING']; break;
    default: throw new Error(`Unknown frozen cap ${row.name}`);
  }
  return spec;
}

export function assertResourceTrace(spec, trace) {
  assert.equal(trace.name, spec.name);
  assert.equal(trace.closed, true);
  assert.equal(trace.intact, true);
  assert.equal(trace.configuredLimit, spec.configuredLimit);
  assert.equal(trace.exitCode, spec.target > spec.configuredLimit ? 1 : 0, 'runtime cap outcome, not a counter-only pass');
  assert.equal(trace.excessEffects, 0, 'no excess allocation/publication');
  const accounting = new Accounting({});
  for (const event of trace.events ?? []) {
    if (event.op === 'allocate') accounting.allocate(event.id, event.capacity, event.kind);
    else if (event.op === 'release') accounting.release(event.id);
    else accounting.work(event.kind, event.amount, event.phase);
  }
  if (spec.name === 'maxWork') {
    assert.deepEqual(trace.events, spec.events, 'each independent work event, repeats included');
    assert.equal(accounting.total.maxWork, spec.target);
  } else if (spec.name === 'maxRetainedBytes') {
    assert.deepEqual(trace.events, spec.events, 'overlapping old/new capacity, not final length');
    assert.equal(accounting.peak, spec.target); assert.equal(accounting.live.size, 0);
  }
  assert.deepEqual(trace.independent, spec.independent);
}

export function assertLimitError(name, command, remainingLocal, remainingParent, trace) {
  const diagnostic = Buffer.from(`xan ${command}: ${name} limit exceeded\n`);
  assert.equal(trace.exitCode, 1);
  assert.deepEqual(trace.stderr, diagnostic.length <= Math.min(remainingLocal, remainingParent) ? diagnostic : Buffer.alloc(0));
  assert.equal(trace.excessEffects, 0);
}
