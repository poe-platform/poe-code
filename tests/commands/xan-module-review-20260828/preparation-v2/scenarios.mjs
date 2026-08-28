import assert from 'node:assert/strict';
import { bytes } from '../core.mjs';
import { Scope, deferred, faithfulCSV, mockFS } from '../mocks.mjs';

const common = { closed: true, intact: true, acquisitionsAfterClose: 0, borrowedReturn: 0, borrowedThrow: 0 };

export function scenarios() {
  const rows = [];
  const add = (id, family, input, expected) => rows.push({ id, family, input, expected: { ...common, ...expected } });
  const workflowBytes = 'right,left,right\nC,A,C\n';
  for (const route of ['files', 'pipe']) add(`F01-${route}`, 'F01', {
    route, input: 'left,right,right\nA,B,C\n', commands: [['select', '2,0,2'], ['slice', '-l', '1'], ['count']],
    parent: { cwd: '/work', env: { KEEP: 'parent' }, outputBudget: 4096, workBudget: 8192 },
  }, { stdout: '1\n', stageBytes: [workflowBytes, workflowBytes],
    files: route === 'files' ? { 'first.csv': workflowBytes, 'second.csv': workflowBytes } : {},
    middleware: ['select:before', 'select:after', 'slice:before', 'slice:after', 'count:before', 'count:after'],
    parentUnchanged: true, sharedBudgetIdentity: true, cumulativeInvocationCounts: [1, 2, 3], registryCount: 77, publicXanExport: false,
    events: ['register', 'acquire', 'command-finally', 'root-drain', 'exec-settle', 'dispose-settle'] });
  add('F01-alias-h', 'F01', { commands: [['h', '-j'], ['headers', '-j']], input: 'id,id,\n' }, { outputs: ['id\nid\n\n', 'id\nid\n\n'], middlewareCalls: 4, parentUnchanged: true });
  for (const origin of [true, false]) add(`F04-empty-origin-${origin}`, 'F04', { stdinIsDefault: origin, input: '' }, { stdout: '', forwardedOrigin: origin, cells: 0 });
  for (const delivery of ['poison-next', 'delivered-invalid-tail']) add(`F04-header-${delivery}`, 'F04', { input: 'a,b\n', tailHex: 'ff22', delivery }, { stdout: 'a\nb\n', nextCalls: 1, parsedBytes: 4, chargedBytes: delivery === 'poison-next' ? 4 : 6 });
  for (const id of ['Z01', 'Z02', 'Z09', 'Z10', 'ordinary-l0', 'ordinary-e0', 'ordinary-start-end', 'positive-tail']) {
    const noRead = id === 'Z02' || id === 'Z10';
    const ordinary = id.startsWith('ordinary');
    add(`F06-${id}`, 'F06', { caseId: id, input: 'a\n0\n1\n2\n', deliveries: ['a\n', '0\n', '1\n', '2\n'], poisonAcquisition: noRead }, {
      dataReads: noRead ? 0 : ordinary || id === 'positive-tail' ? 5 : id === 'Z09' ? 2 : 1,
      metadataValidated: true, limitsValidated: true, aliasValidated: true,
      publication: id === 'Z10' ? ['new.csv', ''] : null, emptyCreateThenAppend: false, fullEOF: ordinary || id === 'positive-tail',
    });
  }
  for (const ownership of ['borrowed', 'cooperative-owned', 'direct-finally-only']) for (const stop of ['header', 'satisfied-range', 'tail-EOF']) add(`F07-${ownership}-${stop}`, 'F07', { ownership, stop }, {
    releases: ownership === 'borrowed' ? 0 : 1, nextAfterSatisfied: 0,
    events: ownership === 'cooperative-owned' ? ['register', 'acquire', 'close', 'release', 'root-drain', 'exec-settle'] : ['acquire', 'finally', 'exec-settle'],
  });
  for (const trigger of ['preabort', 'read', 'write', 'late-acquisition', 'overlap-dispose', 'failing-cleanup', 'opaque-late-rejection', 'equal-local-reason']) {
    for (const reasonKind of ['primitive', 'errno-object']) add(`F08-${trigger}-${reasonKind}`, 'F08', { trigger, reasonKind }, {
      reasonChannel: 'caller', releases: trigger === 'preabort' ? 0 : 1, allCleanupsStarted: true,
      opaqueObserved: true, opaqueAwaitedForSettlement: false, closeSharesPromise: true,
      events: trigger === 'preabort' ? ['register', 'root-drain', 'exec-settle', 'dispose-settle'] :
        ['register', 'acquire-admitted', 'close', 'acquire-resolved', 'release', 'root-drain', 'exec-settle', 'dispose-settle', 'opaque-reject-observed'],
    });
  }
  for (const precedence of ['escaping-over-local', 'cleanup-only', 'mapped-status-not-escaping']) add(`F08-${precedence}`, 'F08', { precedence }, {
    reasonChannel: precedence === 'escaping-over-local' ? 'escaping' : precedence === 'cleanup-only' ? 'cleanup' : 'local',
    allCleanupsStarted: true, events: ['register', 'close', 'release', 'root-drain', 'exec-settle'],
  });
  for (const variant of ['stdout-local-close', 'opaque-unenrolled', 'fallback-success', 'fallback-prepublication-limit', 'partial-writer', 'wrapper-not-owned']) add(`F09-${variant}`, 'F09', { variant }, {
    outputOperationBeforeAcquire: true, siblingFileAlive: true, siblingStderrAlive: true, contextAborted: false,
    file: variant === 'partial-writer' ? 'ack' : variant === 'fallback-prepublication-limit' ? 'original' : 'complete\n',
    stdout: '', rollback: false, emptyProbe: false, appendCalls: 0,
    fallbackCalls: variant === 'fallback-success' ? 1 : 0, wrapperOwnsChild: false,
  });
  const aliasRows = [
    ['new', 'wx', null], ['distinct-complete', 'w', null], ['same-path', null, 'EINVAL'], ['hardlink', null, 'EINVAL'],
    ['followed-symlink', null, 'EINVAL'], ['dangling-symlink', null, 'ENOTSUP'], ['unknown', null, 'ENOTSUP'],
    ['borrowed-existing', null, 'ENOTSUP'], ['conflicting-authority', null, 'EIO'], ['invalid-comparison', null, 'EIO'],
    ['permission', null, 'EACCES'], ['raced-wx', 'wx', 'EEXIST'], ['unsupported-wx', 'wx', 'ENOTSUP'],
    ['missing-readStream', null, 'ENOTSUP'], ['readonly', 'w', 'EROFS'], ['missing-input', null, 'ENOENT'], ['partial-space', 'w', 'ENOSPC'],
  ];
  for (const wrapper of ['direct', 'faithful', 'copy-up']) for (const [kind, flag, error] of aliasRows) {
    add(`F10-${wrapper}-${kind}`, 'F10', { wrapper, kind, permissions: false, conditionalWrite: flag, error }, {
      status: error ? 1 : 0, errorMeaning: error, signalForwarded: true, metadataOnlyBeforeGuard: true,
      completeIdentityBypassesQueries: kind === 'distinct-complete' || kind === 'hardlink',
      queryPerDistinctAuthorityMaximum: 1, assertionPreserved: wrapper !== 'copy-up', changedBackingRebound: wrapper === 'copy-up',
      writeFlags: flag ? [flag] : [], inputUnchanged: true,
      output: kind === 'raced-wx' ? 'raced' : kind === 'partial-space' ? 'ack' : error ? 'original' : 'result\n',
      retryW: false, chmodCalls: 0, mkdirCalls: 0, explicitMode: false,
      destructiveBeforeGuard: 0, errorPath: error ? kind === 'missing-input' || kind === 'missing-readStream' ? '/work/input.csv' : '/work/out.csv' : null,
    });
  }
  for (const id of ['X4-C-preio-file', 'X4-C-resolution-file', 'X4-C-borrowed-lifetime']) {
    for (const delivery of ['one', 'split', 'read-ahead']) add(`${id}-${delivery}`, 'SELECTOR-PHASE', { id, delivery, headerEndByte: 4, chunks: delivery === 'split' ? [1, 1, 2] : [delivery === 'one' ? 4 : 7] }, {
      fsCalls: id === 'X4-C-preio-file' ? 0 : 3, nextCalls: id === 'X4-C-preio-file' ? 0 : delivery === 'split' ? 3 : 1,
      chargedBytes: id === 'X4-C-preio-file' ? 0 : delivery === 'read-ahead' ? 7 : 4,
      parsedBytes: id === 'X4-C-preio-file' ? 0 : 4, outputCreated: false, stdout: '',
      ownedReleaseBeforeSettlement: id === 'X4-C-resolution-file', inputUnchanged: true,
    });
  }
  return rows;
}

export function references(spec) {
  const caller = spec.input.reasonKind === 'primitive' ? 17 : Object.freeze({ code: 'ENOENT', label: 'caller' });
  return { caller, local: spec.input.reasonKind === 'primitive' ? 17 : Object.freeze({ code: 'ENOENT', label: 'local' }),
    escaping: new Error('escaping-control'), cleanup: new Error('cleanup-only') };
}

export function assertScenario(spec, observed, refs) {
  for (const [key, expected] of Object.entries(spec.expected)) assert.deepEqual(observed[key], expected, `${spec.id}:${key}`);
  if (spec.expected.reasonChannel) assert.ok(Object.is(observed.reason, refs[spec.expected.reasonChannel]), 'exact reason reference and provenance');
  if (observed.events?.includes('acquire-admitted')) assert.ok(observed.events.indexOf('register') < observed.events.indexOf('acquire-admitted'));
  if (observed.events?.includes('root-drain')) assert.ok(observed.events.indexOf('root-drain') < observed.events.indexOf('exec-settle'));
}

export async function cooperativeControl(mutant = false) {
  const cleanups = [];
  const scope = new Scope();
  const acquire = deferred();
  const release = deferred();
  let releaseCount = 0;
  let settled = false;
  scope.register(callback => cleanups.push(callback));
  const resource = {};
  const admitted = scope.acquire(() => acquire.promise, async value => { assert.equal(value, resource); releaseCount++; await release.promise; });
  const first = cleanups[0]();
  const second = scope.close();
  assert.equal(first, second);
  first.then(() => { settled = true; });
  acquire.resolve(resource);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const prematurelySettled = mutant || settled;
  release.resolve();
  await Promise.all([admitted, first, second]);
  assert.equal(prematurelySettled, false, 'public cooperative drain must remain pending');
  assert.equal(releaseCount, 1);
  assert.throws(() => scope.acquire(() => ({}), () => {}));
}

export function guards(limitRows) {
  const rows = [];
  for (const row of limitRows) for (const [suffix, value] of [['zero', 0], ['negative', -1], ['fraction', 1.5], ['nan', NaN], ['infinity', Infinity], ['unsafe', Number.MAX_SAFE_INTEGER + 1], ['string', '1'], ['above', row.hardCeiling + 1]]) {
    rows.push({ id: `guard-${row.name}-${suffix}`, kind: 'limit', name: row.name, value, errorName: 'RangeError', message: `Invalid xan limit: ${row.name}`, beforeIO: true });
  }
  for (const [id, value] of [['nonarray', {}], ['number-token', [1]], ['null-token', [null]], ['surrogate', ['count', '\ud800']]]) rows.push({ id: `argv-${id}`, kind: 'argv', value, refusal: true, beforeIO: true });
  return rows;
}

export function assertGuard(spec, trace) {
  assert.equal(trace.ioCalls, 0);
  assert.equal(trace.refused, true);
  if (spec.errorName) { assert.equal(trace.error?.name, spec.errorName); assert.equal(trace.error?.message, spec.message); }
}

export function flagVariants(rows) {
  const byId = new Map(rows.map(row => [row.id, row]));
  return [
    ['Z01', ['slice', '--last', '0']], ['Z02', ['slice', '-nL0']], ['Z09', ['slice', '--len=1']],
    ['B01-R1-repeat', ['count', '-nn']], ['B01-R6-L-range', ['slice', '--last=0', '--len=0']],
    ['B01-R6-I-range', ['slice', '--indices=0', '--start=1']], ['B01-R6-L-I', ['slice', '-L0', '-I0']],
    ['B01-R7-invalid-plural', ['slice', '--indices=x']],
  ].map(([id, argv], index) => ({ ...byId.get(id), id: `flag-${index}-${id}`, originalId: id, argv }));
}

export function assertLogicalVectors(documents, row, record) {
  const vectors = documents['final-freeze-v3/CONTROLS.json'].families.find(family => family.id === 'F12').logicalVectors;
  if (!vectors[row.id]) return;
  const data = row.id === 'X01' ? record.files['out.scsv'] : record.stdout.data;
  const decoded = faithfulCSV(data, row.id === 'X01' ? 59 : 44);
  assert.deepEqual(['T02S', 'T02L', 'T09S'].includes(row.id) ? decoded.slice(1) : decoded, vectors[row.id]);
}

export async function runMockFault(kind) {
  const reason = Object.freeze({ code: 'ENOENT', origin: 'caller' });
  const controller = new AbortController();
  const original = { 'input.csv': { utf8: 'a\nx\n' } };
  const setup = { race: kind === 'race', unsupportedWx: kind === 'unsupported', failAfterPrefix: kind === 'partial', noWriteStream: kind === 'fallback' };
  const host = mockFS(original, setup);
  const stream = async function* () { yield Buffer.from('ack'); yield Buffer.from('tail'); };
  let error;
  if (kind === 'cancel') controller.abort(reason);
  try {
    if (kind === 'fallback') await host.fs.writeFile('/work/out.csv', Buffer.from('acktail'), { flag: 'wx', signal: controller.signal });
    else await host.fs.writeStream('/work/out.csv', stream(), { flag: 'wx', signal: controller.signal });
  } catch (caught) { error = caught; }
  if (kind === 'cancel') assert.equal(error, reason);
  else if (kind === 'race') assert.equal(error?.code, 'EEXIST');
  else if (kind === 'unsupported') assert.equal(error?.code, 'ENOTSUP');
  else if (kind === 'partial') assert.equal(error?.code, 'ENOSPC');
  else assert.equal(error, undefined);
  assert.deepEqual(host.snapshot()['input.csv'], bytes(original['input.csv']));
  const expected = { race: 'raced\n', partial: 'ack', fallback: 'acktail', success: 'acktail' }[kind];
  if (expected !== undefined) assert.deepEqual(host.snapshot()['out.csv'], Buffer.from(expected));
  else assert.equal(Object.hasOwn(host.snapshot(), 'out.csv'), false);
  assert.equal(host.events.filter(event => event.flag === 'w').length, 0);
  return { kind, effects: Object.keys(host.snapshot()), calls: host.events.length, errorShapeOnlyNotActualFsError: true };
}
