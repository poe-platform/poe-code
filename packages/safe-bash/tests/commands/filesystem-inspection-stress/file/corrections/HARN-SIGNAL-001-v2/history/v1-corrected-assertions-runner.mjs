import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtures, cases, policy } from './corpus.mjs';
import { deadline, deferred, fileEntry, launch, outputText, probeFs, sourceProbe, traceJson, turn } from './probes.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fixture = (id) => fixtures.find((entry) => entry.id === id);
const flags = [['brief-human', ['-b']], ['brief-mime', ['-b', '--mime']], ['brief-mime-type', ['-b', '--mime-type']], ['brief-mime-encoding', ['-b', '--mime-encoding']]];
const stdout = (invocation) => outputText(invocation.stdout);
const stderr = (invocation) => outputText(invocation.stderr);
const diagnosis = (invocation) => `${stdout(invocation)}\n${stderr(invocation)}`;
const semanticMatch = (actual, view, expected) => {
  if (view === 'brief-human') return new RegExp(expected.human, 'iu').test(actual.trim());
  if (view === 'brief-mime-type') return expected.mime.includes(actual.trim());
  if (view === 'brief-mime-encoding') return expected.encoding.includes(actual.trim());
  return expected.mime.some((mime) => expected.encoding.some((encoding) => actual === `${mime}; charset=${encoding}\n`));
};

export async function runHoldouts(adapter) {
  assert.equal(adapter.candidate?.finished, true, 'Root must attest candidate is finished before running');
  assert.match(adapter.candidate?.sourceSha256 ?? '', /^[a-f0-9]{64}$/u, 'Require frozen candidate source hash');
  assert.equal(typeof adapter.execute, 'function');
  assert.equal(typeof adapter.fsError, 'function');
  assert.equal(typeof adapter.shell, 'function', 'Actual Shell bridge is required, never a stub');
  assert.equal(adapter.shellUsesActualShell, true);
  const bound = adapter.prefixBytes;
  assert(Number.isSafeInteger(bound) && bound >= 128 && bound <= 1048576, 'Document effective public prefix bound; unsupported harness size is not candidate failure');
  const expected = JSON.parse(await readFile(join(root, 'expectations.json'), 'utf8'));
  const reports = [];
  const makeFs = (entries, hooks) => probeFs(adapter.fsError, entries, hooks);
  const invoke = async (fs, args, options) => {
    const invocation = launch(adapter, fs, args, options);
    invocation.result = await deadline(invocation.promise, args.join(' '));
    return invocation;
  };
  const successful = (invocation) => {
    assert.equal(invocation.result.exitCode, 0);
    assert.equal(stderr(invocation), '');
  };
  const record = async (id, operation) => {
    if (id !== adapter.caseId) return;
    adapter.caseStarted(id);
    const row = { id, semanticStatus: 'not-run', nativeStatus: 'not-run', evidence: {} };
    reports.push(row);
    try {
      await operation(row);
      if (row.semanticStatus === 'not-run') row.semanticStatus = 'pass';
    } catch (error) {
      row.semanticStatus = 'fail';
      row.error = { name: error?.name, message: error?.message ?? String(error), stack: error?.stack };
    }
  };

  for (const entry of fixtures) await record(entry.id, async (row) => {
    row.evidence.views = [];
    for (const [view, args] of flags) {
      const rig = makeFs({ '/input': fileEntry(entry.bytes) });
      const invocation = await invoke(rig.fs, [...args, '/input']);
      const native = expected.find((value) => value.id === entry.id).nativeExact[view];
      row.evidence.views.push({ view, stdout: stdout(invocation), stderr: stderr(invocation), exitCode: invocation.result.exitCode, trace: traceJson(rig.trace), semantic: semanticMatch(stdout(invocation), view, entry.semantic), nativeExact: native.available && stdout(invocation) === native.stdout && stderr(invocation) === native.stderr && invocation.result.exitCode === native.status, nativeAvailable: native.available });
    }
    row.nativeStatus = row.evidence.views.some((view) => !view.nativeAvailable) ? 'oracle-unavailable' : row.evidence.views.every((view) => view.nativeExact || view.view === 'brief-human') ? 'pass' : 'native-profile-conflict';
    const unsupported = adapter.unsupportedFormats?.includes(entry.id) === true;
    if (unsupported) row.semanticStatus = 'unsupported';
    else assert(row.evidence.views.every((view) => view.semantic && view.stderr === '' && view.exitCode === 0), 'Frozen semantic/view expectations');
  });

  await record('F21', async (row) => {
    const rig = makeFs({ '/input': { type: 'directory' } });
    const invocation = await invoke(rig.fs, ['-b', '--mime', '/input']);
    successful(invocation);
    assert.equal(stdout(invocation), 'inode/directory; charset=binary\n');
    assert(!rig.trace.some((entry) => ['readFile', 'readStream', 'readdir'].includes(entry.method)));
    row.evidence.trace = traceJson(rig.trace);
  });
  for (const [id, follow] of [['F22', false], ['F23', true]]) await record(id, async (row) => {
    const rig = makeFs({ '/link': { type: 'symlink', target: '/picture' }, '/picture': fileEntry(fixture('F09').bytes) });
    const invocation = await invoke(rig.fs, [...(follow ? ['-L'] : []), '-b', '--mime', '/link']);
    successful(invocation);
    if (follow) assert.equal(stdout(invocation), 'image/png; charset=binary\n');
    else {
      assert.match(stdout(invocation), /^inode\/(?:x-)?symlink; charset=binary\n$/u);
      assert(!rig.trace.some((entry) => ['readFile', 'readStream'].includes(entry.method)));
    }
    row.evidence = { stdout: stdout(invocation), trace: traceJson(rig.trace) };
  });
  for (const [id, entries, operand, pattern] of [
    ['F24', { '/dangling': { type: 'symlink', target: '/missing' } }, '/dangling', /missing|no such|cannot|broken|dangling/iu],
    ['F25', { '/cycle-a': { type: 'symlink', target: '/cycle-b' }, '/cycle-b': { type: 'symlink', target: '/cycle-a' } }, '/cycle-a', /loop|too many|cyclic|cycle/iu],
  ]) await record(id, async (row) => {
    const rig = makeFs(entries);
    const invocation = await invoke(rig.fs, ['-L', operand]);
    assert.match(diagnosis(invocation), pattern);
    assert(diagnosis(invocation).includes(operand));
    assert(!/charset=|ASCII text|image\/|\bempty\b/u.test(stdout(invocation)));
    assert(rig.trace.length < 100, 'bounded resolution');
    row.evidence.nativeComparison = 'not-run: error presentation differs by path and command profile; reference retained separately';
    row.evidence = { stdout: stdout(invocation), stderr: stderr(invocation), exitCode: invocation.result.exitCode, trace: traceJson(rig.trace) };
  });
  await record('F26', async (row) => {
    const canaryPath = join(root, 'native-fixtures', 'F09-picture.txt');
    const rig = makeFs({ '/absolute': { type: 'symlink', target: canaryPath }, [canaryPath]: fileEntry(fixture('F02').bytes) });
    const invocation = await invoke(rig.fs, ['-L', '-b', '--mime', '/absolute']);
    successful(invocation);
    assert.equal(stdout(invocation), 'text/plain; charset=us-ascii\n');
    row.evidence = { canaryPath, trace: traceJson(rig.trace), limitation: 'One exercised route, not universal sandbox proof' };
  });
  await record('F27', async (row) => {
    const bytes = Buffer.alloc(bound, 0);
    bytes.set(fixture('F09').bytes);
    const probe = sourceProbe([bytes], { poisonTail: true });
    const rig = makeFs({ '/input': { ...fileEntry(bytes), size: bound + 4096 } }, { readStream: () => probe.source });
    const invocation = await invoke(rig.fs, ['-b', '--mime', '/input']);
    successful(invocation);
    assert.equal(stdout(invocation), 'image/png; charset=binary\n');
    assert.equal(probe.trace.next, 1);
    assert.equal(probe.trace.returned, 1);
    row.evidence = { source: probe.trace, fs: traceJson(rig.trace), bound };
  });
  await record('F28', async (row) => {
    const bytes = Buffer.alloc(bound, 97);
    bytes[bound - 1] = 0xe2;
    const probe = sourceProbe([bytes], { poisonTail: true });
    const rig = makeFs({ '/input': { ...fileEntry(bytes), size: bound + 2 } }, { readStream: () => probe.source });
    const boundary = await invoke(rig.fs, ['-b', '--mime', '/input']);
    successful(boundary);
    assert.equal(probe.trace.next, 1);
    assert.equal(probe.trace.returned, 1);
    assert.match(stdout(boundary), /^(?:text\/plain|application\/octet-stream); charset=(?:us-ascii|utf-8|binary|unknown-8bit|iso-8859-1)\n$/u);
    const split = sourceProbe([...fixture('F03').bytes].map((byte) => Uint8Array.of(byte)));
    const segmented = await invoke(makeFs({}).fs, ['-b', '--mime', '-'], { stdin: split.source });
    successful(segmented);
    assert.equal(stdout(segmented), 'text/plain; charset=utf-8\n');
    row.evidence = { boundary: stdout(boundary), source: probe.trace, segmented: stdout(segmented), bound };
    row.nativeStatus = 'not-run';
  });
  await record('F29', async (row) => {
    const rig = makeFs({ '/input': fileEntry(fixture('F09').bytes) }, { readFileOnly: true });
    const invocation = await invoke(rig.fs, ['-b', '--mime', '/input']);
    successful(invocation);
    assert.equal(stdout(invocation), 'image/png; charset=binary\n');
    assert(rig.trace.some((entry) => entry.method === 'readFile'));
    for (const entry of rig.trace) {
      assert(entry.options?.signal instanceof AbortSignal);
      assert.equal(entry.options.signal.aborted, false);
      assert.equal(entry.options.signal.reason, undefined);
    }
    row.evidence.trace = traceJson(rig.trace);
  });
  for (const [id, unknown] of [['F30', false], ['F31', true]]) await record(id, async (row) => {
    const rig = makeFs({ '/input': { ...fileEntry(fixture('F09').bytes), size: bound + 4096 } }, {
      readFileOnly: true,
      before(method, path) { if (unknown && ['lstat', 'stat'].includes(method)) throw adapter.fsError('ENOTSUP', { path, syscall: method }); },
      readFile(path, options) {
        assert(Number.isSafeInteger(options?.maxBytes) && options.maxBytes > 0 && options.maxBytes <= bound, 'readFile fallback must be guarded, never retry unbounded');
        assert(options.signal instanceof AbortSignal);
        throw adapter.fsError('EFBIG', { path, syscall: 'readFile' });
      },
    });
    const invocation = await invoke(rig.fs, ['-b', '--mime', '/input']);
    for (const entry of rig.trace.filter((value) => value.method === 'readFile')) {
      assert(Number.isSafeInteger(entry.options?.maxBytes) && entry.options.maxBytes > 0 && entry.options.maxBytes <= bound, 'No unbounded readFile request, even if product catches harness assertion');
      assert.equal(entry.options.signal, invocation.context.signal);
    }
    assert.match(diagnosis(invocation), /large|limit|bound|support|cannot|failed/iu);
    assert(!/charset=|inode\/x-empty/u.test(stdout(invocation)));
    row.semanticStatus = 'backend-limitation';
    row.evidence = { stdout: stdout(invocation), stderr: stderr(invocation), exitCode: invocation.result.exitCode, trace: traceJson(rig.trace) };
  });
  await record('F32', async (row) => {
    const bytes = Buffer.alloc(bound + 4096, 97);
    bytes[bound] = 0;
    bytes.set(fixture('F09').bytes, bound + 1);
    const probe = sourceProbe([bytes], { poisonTail: true });
    const invocation = await invoke(makeFs({}).fs, ['-b', '--mime', '-'], { stdin: probe.source });
    successful(invocation);
    assert.equal(stdout(invocation), 'text/plain; charset=us-ascii\n');
    assert.equal(probe.trace.next, 1);
    assert.equal(probe.trace.returned, 1);
    row.evidence = { source: probe.trace, bound, allocatedByHarness: bytes.length, limitation: 'Consumer cannot prevent upstream allocation' };
  });
  for (const id of ['F33', 'F34']) await record(id, async (row) => {
    const controller = new AbortController();
    const started = deferred();
    const pendingRead = deferred();
    const pendingReturn = deferred();
    const lateReadError = new Error('sealed late read error');
    const lateReturnError = new Error('sealed late iterator return error');
    const reason = adapter.fsError('ENOENT', { path: '/cancel-sentinel', syscall: 'holdout' });
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    let returned = 0;
    let capturedSignal;
    const source = {
      [Symbol.asyncIterator]() { return this; },
      next() { started.resolve(); return pendingRead.promise; },
      return() { returned++; return id === 'F34' ? pendingReturn.promise : Promise.resolve({ done: true, value: undefined }); },
    };
    const rig = makeFs({ '/input': fileEntry(fixture('F09').bytes) }, { readStream(path, options) { capturedSignal = options?.signal; return source; } });
    process.on('unhandledRejection', onUnhandled);
    const invocation = launch(adapter, rig.fs, ['-b', '--mime', '/input'], { signal: controller.signal });
    try {
      await deadline(started.promise, `${id} initial next`);
      controller.abort(reason);
      await assert.rejects(deadline(invocation.promise, `${id} cancellation`), (error) => error === reason);
      await turn();
      assert(capturedSignal instanceof AbortSignal);
      assert.equal(capturedSignal.aborted, true);
      assert.equal(capturedSignal.reason, reason);
      assert.equal(returned, 1);
      pendingRead.reject(lateReadError);
      if (id === 'F34') pendingReturn.reject(lateReturnError);
      await turn();
      await turn();
      assert.deepEqual(unhandled, []);
      row.evidence = { returned, exactAbortIdentity: true, lateErrorsObserved: true };
    } finally {
      controller.abort(reason);
      pendingRead.resolve({ done: true, value: undefined });
      pendingReturn.resolve({ done: true, value: undefined });
      await turn();
      process.off('unhandledRejection', onUnhandled);
    }
  });
  await record('F35', async (row) => {
    const rig = makeFs({ '/letter': fileEntry(fixture('F02').bytes), '/picture': fileEntry(fixture('F09').bytes) });
    const entered = deferred();
    const gate = deferred();
    const chunks = [];
    let active = 0;
    let overlap = false;
    let complete = false;
    const sink = { async write(chunk) {
      assert(chunk instanceof Uint8Array);
      active++;
      if (active > 1) overlap = true;
      chunks.push({ reference: chunk, snapshot: new Uint8Array(chunk) });
      entered.resolve();
      await gate.promise;
      active--;
    } };
    const invocation = launch(adapter, rig.fs, ['-b', '--mime', '/letter', '/picture'], { stdout: sink });
    void invocation.promise.then(() => { complete = true; }, () => { complete = true; });
    try {
      await deadline(entered.promise, 'sink first write');
      await turn();
      assert.equal(complete, false);
      assert.equal(overlap, false);
      gate.resolve();
      invocation.result = await deadline(invocation.promise, 'sink release');
      successful(invocation);
      assert.equal(overlap, false);
      for (const chunk of chunks) assert.deepEqual(Buffer.from(chunk.reference), Buffer.from(chunk.snapshot));
      assert.equal(outputText(chunks.map((chunk) => chunk.reference)), 'text/plain; charset=us-ascii\nimage/png; charset=binary\n');
      const sentinel = new Error('sealed sink rejection');
      const rejected = launch(adapter, rig.fs, ['-b', '--mime', '/letter'], { stdout: { write: () => Promise.reject(sentinel) } });
      const outcome = await deadline(rejected.promise.then((result) => ({ result }), (error) => ({ error })), 'sink rejection');
      assert(outcome.error || outcome.result?.exitCode !== 0, 'Sink failure cannot become command success');
      row.evidence = { writes: chunks.length, overlap, retainedBytesUnchanged: true };
    } finally { gate.resolve(); }
  });
  await record('F36', async (row) => {
    const rig = makeFs({ '/denied': fileEntry(fixture('F02').bytes), '/picture': fileEntry(fixture('F09').bytes) }, { before(method, path) { if (path === '/denied') throw adapter.fsError('EACCES', { path, syscall: method }); } });
    const invocation = await invoke(rig.fs, ['--mime', '/denied', '/picture']);
    assert.match(diagnosis(invocation), /permission|denied|not permitted/iu);
    assert(diagnosis(invocation).includes('/denied'));
    assert.match(stdout(invocation), /image\/png; charset=binary/u);
    assert(!rig.trace.some((entry) => entry.path === '/denied' && ['readFile', 'readStream'].includes(entry.method)));
    row.nativeStatus = 'not-run';
    row.evidence = { stdout: stdout(invocation), stderr: stderr(invocation), exitCode: invocation.result.exitCode, trace: traceJson(rig.trace) };
  });
  await record('F37', async (row) => {
    const rig = makeFs({ '/vanished': fileEntry(fixture('F02').bytes) }, { before(method, path) { if (['readFile', 'readStream'].includes(method)) throw adapter.fsError('ENOENT', { path, syscall: method }); } });
    const invocation = await invoke(rig.fs, ['--mime', '/vanished']);
    assert.match(diagnosis(invocation), /no such|missing|cannot|not found/iu);
    assert(diagnosis(invocation).includes('/vanished'));
    assert(!/charset=|inode\/x-empty/u.test(stdout(invocation)));
    row.evidence = { stdout: stdout(invocation), stderr: stderr(invocation), exitCode: invocation.result.exitCode, trace: traceJson(rig.trace) };
  });
  await record('F38', async (row) => {
    const bytes = fixture('F09').bytes;
    const emitted = [];
    const producer = { name: 'holdout-byte-source', async execute(context) {
      let offset = 0;
      for (const size of [1, 2, 5, 3, bytes.length - 11]) {
        const chunk = new Uint8Array(bytes.subarray(offset, offset + size));
        emitted.push(new Uint8Array(chunk));
        await context.stdout.write(chunk);
        offset += size;
      }
      return { exitCode: 0 };
    } };
    const rig = makeFs({ '/picture': fileEntry(bytes) });
    const piped = await deadline(adapter.shell({ fs: rig.fs, script: 'holdout-byte-source | file -b --mime -', commands: [producer] }), 'actual Shell pipeline');
    assert.equal(piped.exitCode, 0);
    assert.equal(piped.stdout, 'image/png; charset=binary\n');
    assert.equal(piped.stderr, '');
    assert.deepEqual(Buffer.concat(emitted), bytes);
    const redirected = await deadline(adapter.shell({ fs: rig.fs, script: 'file -b --mime - < /picture', commands: [] }), 'actual Shell redirection');
    assert.equal(redirected.exitCode, 0);
    assert.equal(redirected.stdout, piped.stdout);
    assert.equal(redirected.stderr, '');
    row.evidence = { piped, redirected, emittedBytes: bytes.length };
  });
  await record('F39', async (row) => {
    const rig = makeFs({ '/letter': fileEntry(fixture('F02').bytes), '/empty': fileEntry(fixture('F01').bytes) });
    row.evidence.invocations = [];
    for (const brief of [false, true]) {
      const result = await deadline(adapter.shell({ fs: rig.fs, script: `file ${brief ? '-b ' : ''}--mime /letter - /empty`, stdin: sourceProbe([fixture('F09').bytes]).source, commands: [] }), 'actual Shell multiinput');
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, '');
      const lines = result.stdout.trimEnd().split('\n');
      assert.equal(lines.length, 3);
      assert.match(lines[0], /text\/plain; charset=us-ascii$/u);
      assert.match(lines[1], /image\/png; charset=binary$/u);
      assert.match(lines[2], /(?:inode|application)\/x-empty; charset=binary$/u);
      if (brief) assert(lines.every((line) => !line.includes(':')));
      else { assert(lines[0].includes('/letter')); assert(lines[2].includes('/empty')); assert.match(lines[1], /stdin|standard input|^\s*-\s*:/iu); }
      row.evidence.invocations.push({ brief, result });
    }
  });
  await record('F40', async (row) => {
    const controller = new AbortController();
    const reason = adapter.fsError('EACCES', { path: '/preaborted', syscall: 'holdout' });
    controller.abort(reason);
    const rig = makeFs({ '/input': fileEntry(fixture('F09').bytes) });
    const touched = [];
    const stdin = { [Symbol.asyncIterator]() { touched.push('stdin'); throw new Error('preabort input acquisition'); } };
    const sink = { async write() { touched.push('sink'); throw new Error('preabort output'); } };
    const invocation = launch(adapter, rig.fs, ['-b', '--mime', '/input'], { signal: controller.signal, stdin, stdout: sink, stderr: sink });
    await assert.rejects(deadline(invocation.promise, 'preabort direct'), (error) => error === reason);
    assert.deepEqual(rig.trace, []);
    assert.deepEqual(touched, []);
    await assert.rejects(deadline(adapter.shell({ fs: rig.fs, script: 'file -b --mime /input', signal: controller.signal, stdin, commands: [] }), 'preabort actual Shell'), (error) => error === reason);
    assert.deepEqual(rig.trace, []);
    assert.deepEqual(touched, []);
    row.evidence.exactAbortIdentity = true;
  });
  assert.equal(reports.length, 1, "One selected frozen case per isolated child");
  return { candidate: adapter.candidate, effectivePrefixBytes: bound, policy, startedFromFrozenHoldouts: true, reportedAt: new Date().toISOString(), reports };
}
