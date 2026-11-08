import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, copyFile, chmod, symlink } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, check, Hold, bytes, sha, fingerprint, writeNew, inventory, verifyTree, reasonIdentity, relative } from './core.mjs';
import { loadBinding, pinnedDocuments, verifySeal } from './protocol.mjs';
import { casesFrom, aggregate, assertCase, executeCase } from './executor.mjs';
import { Ledger, deferred, Scope, source, sink, schedule, mockFS, faithfulCSV } from './mocks.mjs';
import { admit, physicalMove } from './admission.mjs';
import { supervise, gitBytes } from './supervisor.mjs';

export async function qualify() {
  const seal = await verifySeal();
  const directory = path.join(ROOT, 'synthetic-evidence');
  await mkdir(directory, { recursive: false });
  const recipeCommit = (await gitBytes(['log', '-1', '--format=%H', '--', 'tests/commands/xan-module-review-20260828/RECIPE-SEAL.json'], 41, path.resolve(ROOT, '../../..'))).toString().trim();
  const preRun = { classification: 'SYNTHETIC_ONLY_NOT_PRODUCT_PASSES', started: new Date().toISOString(), recipeCommit, recipeSeal: await fingerprint(path.join(ROOT, 'RECIPE-SEAL.json')), tools: seal.tools, frozenInputs: (await loadBinding()).inputs, sourceInspection: 0, productExecutions: 0, nativeOracleExecutions: 0, retry: false };
  await writeNew(path.join(directory, 'PRE-RUN.json'), preRun);
  const results = [];
  let number = 0;
  async function probe(id, families, action, verify) {
    const ordinal = String(++number).padStart(3, '0');
    let observation;
    try { observation = { returned: await action() }; }
    catch (error) { observation = { thrown: { code: error.code ?? null, name: error.name, message: String(error.message).slice(0, 1024) } }; }
    await writeNew(path.join(directory, `${ordinal}-${id}.json`), { id, families, observation, classification: 'SYNTHETIC_CONTROL_OBSERVATION_BEFORE_ASSERTION' });
    try { verify(observation); results.push({ id, families, status: 'QUALIFIED_HELPER_ONLY' }); }
    catch (error) { results.push({ id, families, status: 'FAILED_QUALIFICATION', error: { name: error.name, code: error.code ?? null, message: String(error.message).slice(0, 1024) } }); throw error; }
  }
  const equals = expected => observation => assert.deepEqual(observation.returned, expected);
  const throws = code => observation => assert.equal(observation.thrown?.code, code);
  let documents;
  try {
    documents = await pinnedDocuments(await loadBinding());
    await probe('bindings', ['F01', 'F05', 'F12'], async () => {
      const rows = casesFrom(documents);
      const coverage = JSON.parse(await readFile(path.join(ROOT, 'COVERAGE.json'), 'utf8'));
      const prefix = (await loadBinding()).diracPrefix;
      for (const obligation of coverage.obligations) {
        let value = documents[obligation.input.slice(prefix.length)];
        for (const key of obligation.jsonPointer.slice(1).split('/')) value = value[key];
        check(sha(JSON.stringify(value)) === obligation.subtreeSha256, 'OBLIGATION_IDENTITY', obligation.id);
      }
      return { cases: rows.filter(row => row.group === 'prior88').length, selectors: rows.filter(row => row.group === 'selector36').length, ratifiedCases: rows.filter(row => row.group === 'ratification14').length, families: documents['final-freeze-v3/CONTROLS.json'].families.length, caps: documents['final-freeze-v3/LIMITS.json'].rows.length, obligations: coverage.obligations.length };
    }, equals({ cases: 88, selectors: 36, ratifiedCases: 14, families: 12, caps: 18, obligations: 161 }));
    await probe('candidate-absent-before-load', ['F01'], () => admit(null), throws('CANDIDATE_PENDING'));
    await probe('candidate-incomplete-before-load', ['F01'], () => admit({ version: 1 }), throws('HANDOFF_KEYS'));
    await probe('byte-typeguard', ['F12'], () => bytes({ utf8: 'a', hex: '61' }), throws('BYTE_DATUM'));
    await probe('all-frozen-chunk-schedules', ['F02'], () => {
      const ids = documents['final-freeze-v3/CONTROLS.json'].families.find(row => row.id === 'F02').caseIds;
      let schedules = 0;
      for (const id of ids) {
        const input = bytes(documents['final-freeze-v3/CASES.json'].cases.find(row => row.id === id).stdin);
        for (const name of ['P0', 'P1', 'P2', 'P3', ...Array.from({ length: Math.max(0, input.length - 1) }, (_, index) => `CUT:${index + 1}`)]) {
          const lengths = schedule(input.length, name);
          check(lengths.reduce((total, value) => total + value, 0) === input.length, 'SCHEDULE_BYTES'); schedules++;
        }
      }
      return { inputs: ids.length, schedules, sameBytes: true };
    }, observation => { assert.equal(observation.returned?.inputs, 8); assert.equal(observation.returned?.sameBytes, true); assert.ok(observation.returned.schedules > 24); });
    await probe('borrowed-copy-finalization', ['F03', 'F07'], async () => {
      const stream = source(Buffer.from('abcd'), { lengths: [2, 2], reuse: true });
      const iterator = stream[Symbol.asyncIterator]();
      const first = (await iterator.next()).value;
      const copy = Uint8Array.from(first);
      await iterator.next(); await iterator.next();
      return { copy: Buffer.from(copy).toString(), borrowed: first.toString(), returns: stream.events.filter(event => event === 'return').length };
    }, equals({ copy: 'ab', borrowed: 'XX', returns: 0 }));
    await probe('owned-finalizer-mutation', ['F03', 'F07'], async () => {
      const stream = source(Buffer.from('ab'), { reuse: true });
      const first = (await stream.iterator.next()).value;
      const copy = Uint8Array.from(first); await stream.iterator.return();
      return { copy: Buffer.from(copy).toString(), borrowed: first.toString(), returned: stream.events.includes('return') };
    }, equals({ copy: 'ab', borrowed: 'XX', returned: true }));
    await probe('poison-acquisition', ['F04', 'F06'], () => source(Buffer.alloc(0), { poisonAcquire: true })[Symbol.asyncIterator](), throws('POISON_ACQUIRE'));
    await probe('poison-metadata', ['F06', 'F10'], () => mockFS({}, { poison: true }).fs.stat('/work/in.csv'), throws('POISON_FS'));
    await probe('gated-backpressure', ['F09'], async () => {
      const gate = deferred(); const output = sink(4, { gate });
      const first = output.write(Buffer.from('ab'));
      let denied;
      try { await output.write(Buffer.from('c')); } catch (error) { denied = error.code; }
      gate.resolve(); await first;
      return { denied, bytes: output.finish().bytes };
    }, equals({ denied: 'BACKPRESSURE', bytes: 2 }));
    await probe('cleanup-register-before-admit', ['F08'], () => new Scope().acquire(() => 1, () => {}), throws('ADMISSION_CLOSED'));
    await probe('cleanup-late-acquire-overlap', ['F08'], async () => {
      const scope = new Scope(); const registered = []; const gate = deferred(); let released = 0;
      scope.register(callback => registered.push(callback));
      const acquisition = scope.acquire(() => gate.promise, async () => { released++; });
      const first = scope.close(); const second = scope.close();
      gate.resolve({}); await acquisition; await first; await registered[0]();
      let denial; try { scope.acquire(() => 2, () => {}); } catch (error) { denial = error.code; }
      return { shared: first === second, released, denial };
    }, equals({ shared: true, released: 1, denial: 'ADMISSION_CLOSED' }));
    await probe('cleanup-failure-drains-sibling', ['F08'], async () => {
      const scope = new Scope(); let drained = 0; const reason = {};
      scope.register(() => {});
      await scope.acquire(() => 1, () => { throw reason; }); await scope.acquire(() => 2, () => { drained++; });
      let same; try { await scope.close(); } catch (error) { same = error === reason; }
      return { drained, same };
    }, equals({ drained: 1, same: true }));
    await probe('caller-errno-identity', ['F08', 'F10'], async () => {
      const caller = { code: 'ENOENT' }; const local = { code: 'ENOENT' }; const controller = new AbortController(); controller.abort(caller);
      try { await mockFS().fs.stat('/work/input', { signal: controller.signal }); }
      catch (error) { return reasonIdentity(error, [caller, local]); }
    }, equals({ identity: 0, type: 'object', code: null }));
    await probe('wx-race-preserves-creator', ['F10'], async () => {
      const host = mockFS({}, { race: true }); let code;
      try { await host.fs.writeFile('/work/new.csv', Buffer.from('new'), { flag: 'wx' }); } catch (error) { code = error.code; }
      return { code, data: host.snapshot()['new.csv'].toString(), calls: host.events.length };
    }, equals({ code: 'EEXIST', data: 'raced\n', calls: 1 }));
    await probe('wx-unsupported-no-fallback', ['F10'], () => mockFS({}, { unsupportedWx: true }).fs.writeFile('/work/new', Buffer.from('x'), { flag: 'wx' }), throws('ENOTSUP'));
    await probe('alias-identity', ['F10'], async () => {
      const host = mockFS({ 'in.csv': { utf8: 'a\n' } }, { aliases: { '/work/hard.csv': '/work/in.csv' }, links: { '/work/link.csv': '/work/in.csv' } });
      const original = await host.fs.stat('/work/in.csv'); const hard = await host.fs.stat('/work/hard.csv'); const link = await host.fs.stat('/work/link.csv');
      return { hard: original.ino === hard.ino && original.identityScope === hard.identityScope, link: original.ino === link.ino, comparison: await host.fs.compareEntry('/work/hard.csv', host.fs, '/work/link.csv') };
    }, equals({ hard: true, link: true, comparison: 'same' }));
    await probe('stream-fallback-same-flags', ['F09', 'F10'], async () => {
      const streamed = mockFS(); const fallback = mockFS({}, { noWriteStream: true });
      await streamed.fs.writeStream('/work/out', source(Buffer.from('abcd'), { schedule: 'P1' }), { flag: 'wx' });
      await fallback.fs.writeFile('/work/out', Buffer.from('abcd'), { flag: 'wx' });
      return { streamed: streamed.snapshot().out.toString(), fallback: fallback.snapshot().out.toString(), flags: [streamed.events[0].flag, fallback.events[0].flag], writes: [streamed.events.length, fallback.events.length] };
    }, equals({ streamed: 'abcd', fallback: 'abcd', flags: ['wx', 'wx'], writes: [1, 1] }));
    await probe('partial-publication-no-rollback', ['F09'], async () => {
      const host = mockFS({}, { failAfterPrefix: true }); let code;
      try { await host.fs.writeStream('/work/out', source(Buffer.from('abcd'), { lengths: [2, 2] }), { flag: 'wx' }); } catch (error) { code = error.code; }
      return { code, prefix: host.snapshot().out.toString() };
    }, equals({ code: 'ENOSPC', prefix: 'ab' }));
    await probe('csv-cr-bom-quote-vectors', ['F02', 'F12'], () => {
      const vectors = documents['final-freeze-v3/CONTROLS.json'].families.find(row => row.id === 'F12').logicalVectors;
      for (const [id, expected] of Object.entries(vectors)) {
        const row = documents['final-freeze-v3/CASES.json'].cases.find(row => row.id === id);
        const datum = id === 'X01' ? row.expected.files['out.scsv'] : row.expected.stdout;
        let records = faithfulCSV(bytes(datum), id === 'X01' ? 59 : 44);
        if (['T02S', 'T02L'].includes(id)) records = records.slice(1);
        assert.deepEqual(records, expected);
      }
      return Object.keys(vectors).length;
    }, equals(6));
    await probe('csv-invalid-raw-cr', ['F12'], () => faithfulCSV(Buffer.from('a\rb\n')), throws('CSV_GRAMMAR'));
    for (const row of documents['final-freeze-v3/LIMITS.json'].rows) {
      await probe(`cap-${row.name}`, ['F11'], () => {
        const lower = row.name === 'maxSelectorDepth' ? 2 : 8;
        const ledger = new Ledger(lower); ledger.admit(lower - 1); ledger.admit(1);
        let code; try { ledger.admit(1); } catch (error) { code = error.code; }
        return { code, unchanged: ledger.used === lower, defaultValue: row.defaultValue, hardCeiling: row.hardCeiling, kind: 'GENERIC_COUNTER_ONLY_NOT_PRODUCT_TARGET', depthThreeGenerated: false };
      }, observation => { assert.equal(observation.returned?.code, 'QUOTA'); assert.equal(observation.returned.unchanged, true); assert.equal(observation.returned.defaultValue, row.defaultValue); assert.equal(observation.returned.hardCeiling, row.hardCeiling); });
    }
    await probe('fallback-old-new-capacity', ['F09', 'F11'], () => {
      const ledger = new Ledger(7); ledger.admit(4); let code; try { ledger.admit(4); } catch (error) { code = error.code; }
      return { code, used: ledger.used, peak: ledger.peak };
    }, equals({ code: 'QUOTA', used: 4, peak: 4 }));
    await probe('ordinary-failure-aggregation', ['F01'], async () => {
      const receipts = []; let checked = 0;
      const result = await aggregate([{ id: 'bad', async run() { return { reaped: true, closed: true }; }, assert() { assert.equal(1, 2); } }, { id: 'good', async run() { return { reaped: true, closed: true }; }, assert() {} }], async () => { checked++; }, async item => receipts.push(item.stage ?? item.status));
      return { exitCode: result.exitCode, count: result.results.length, checked, receipts };
    }, equals({ exitCode: 1, count: 2, checked: 2, receipts: ['RECEIPT', 'ASSERTION_FAILED', 'RECEIPT', 'ASSERTED'] }));
    await probe('cleanup-fatal-stops-dependent', ['F08'], () => aggregate([{ id: 'bad', async run() { return { reaped: false, closed: false }; }, assert() {} }, { id: 'never', async run() { throw new Error('DEPENDENT_RAN'); }, assert() {} }], async () => {}, async () => {}), throws('DEPENDENTS_HELD_CLEANUP'));
    await probe('integrity-fatal-stops-dependent', ['F01'], () => aggregate([{ id: 'bad', async run() { return { reaped: true, closed: true }; }, assert() {} }, { id: 'never', async run() { throw new Error('DEPENDENT_RAN'); }, assert() {} }], async () => { throw new Hold('INTEGRITY_FATAL'); }, async () => {}), throws('INTEGRITY_FATAL'));
    await probe('executor-receipt-before-assertion', ['F01', 'F07'], async () => {
      const row = { id: 'synthetic-echo', argv: ['literal', '$(not-a-shell)', ';'], stdin: { utf8: 'abc' }, expected: { status: 0, stdout: { utf8: 'abc' }, stderr: { utf8: '' }, files: {} } };
      let receipted = false;
      const record = await executeCase(async context => { const iterator = context.stdin[Symbol.asyncIterator](); while (true) { const next = await iterator.next(); if (next.done) break; await context.stdout.write(next.value); } return { exitCode: 0 }; }, row, { reuse: true, schedule: 'P1', receipt: async () => { receipted = true; } });
      assertCase(row, record);
      return { receipted, returned: record.inputEvents.includes('return') };
    }, equals({ receipted: true, returned: false }));
    await probe('semantic-no-substring-waiver', ['F05', 'F12'], () => {
      const row = { id: 'synthetic-semantic', expected: { status: 1, stdout: { utf8: '' }, stderr: { precision: 'NONEXACT' }, files: {} } };
      return assertCase(row, { failed: false, result: { exitCode: 1 }, stdout: { data: Buffer.alloc(0) }, stderr: { data: Buffer.from('irrelevant xan select') }, files: {}, inputEvents: [], fsEvents: [] });
    }, throws('SEMANTIC_REVIEW_REQUIRED'));
    const stage = path.join(directory, 'source-layout'); await mkdir(stage);
    await copyFile(path.join(ROOT, 'synthetic-module.mjs'), path.join(stage, 'synthetic-module.mjs'));
    await copyFile(path.join(ROOT, 'synthetic-module.mjs'), path.join(directory, 'outside.mjs'));
    const entries = [{ path: 'synthetic-module.mjs', ...await fingerprint(path.join(stage, 'synthetic-module.mjs')) }];
    const manifestFile = path.join(directory, 'layout.json'); await writeNew(manifestFile, entries);
    const manifestIdentity = await fingerprint(manifestFile);
    const moved = await physicalMove({ root: stage, entries }, directory);
    await writeNew(path.join(directory, 'CHILD-INPUTS.json'), { entries, manifest: { path: manifestFile, ...manifestIdentity }, outside: await fingerprint(path.join(directory, 'outside.mjs')), loader: await fingerprint(path.join(ROOT, 'guard.mjs')), supervisor: await fingerprint(path.join(ROOT, 'supervisor.mjs')), worker: await fingerprint(path.join(ROOT, 'synthetic-worker.mjs')), preparedBeforeFirstChild: true });
    await probe('installed-physically-moved', ['F01'], async () => { await verifyTree(moved, entries); return { distinct: moved !== stage, entrySha: (await fingerprint(path.join(moved, 'synthetic-module.mjs'))).sha256 }; }, equals({ distinct: true, entrySha: entries[0].sha256 }));
    for (const [layout, root] of [['SOURCE', stage], ['INSTALLED_MOVED', moved]]) {
      await probe(`${layout}-generic-module-executor`, ['F01', 'F07'], async () => {
        const jobFile = path.join(directory, `${layout}-job.json`);
        const job = { authorization: 'SEALED_SYNTHETIC_QUALIFICATION', layout, root, entries, entry: 'synthetic-module.mjs', factoryExport: 'command', apiAuthority: 'SEALED_SYNTHETIC_ONLY', builtins: [], directOnly: true, outputBytes: 65536, rows: [{ id: 'synthetic-echo-only', argv: ['literal', '$(no-shell)'], stdin: { utf8: 'synthetic\n' }, expected: { status: 0, stdout: { utf8: 'synthetic\n' }, stderr: { utf8: '' }, files: {} } }] };
        await writeNew(jobFile, job);
        const identity = await fingerprint(jobFile);
        const allowedReads = ['module-worker.mjs', 'executor.mjs', 'mocks.mjs', 'core.mjs', 'guard.mjs'].map(name => path.join(ROOT, name)); allowedReads.push(root, jobFile);
        const runDirectory = path.join(directory, `${layout}-generic-process`);
        const receipt = await supervise({ executable: process.execPath, args: ['--experimental-permission', ...allowedReads.map(filename => `--allow-fs-read=${filename}`), '--disallow-code-generation-from-strings', path.join(ROOT, 'module-worker.mjs'), jobFile, String(identity.bytes), identity.sha256], cwd: directory, directory: runDirectory, timeoutMs: 10000, logBytes: 16384, kind: 'SYNTHETIC_GENERIC_MODULE_EXECUTOR' });
        await verifyTree(root, entries);
        const lines = (await readFile(path.join(runDirectory, 'stdout.raw'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        return { code: receipt.code, reaped: receipt.reaped, stages: lines.map(line => line.stage ?? line.status) };
      }, equals({ code: 0, reaped: true, stages: ['RECEIPT_BEFORE_ASSERTION', 'ASSERTED'] }));
      for (const mode of ['valid', 'denyload', 'sourcefallback', 'builtin', 'ambient', 'eval', 'ordinary', 'overflow', 'timeout']) {
        await probe(`${layout}-${mode}`, ['F01', 'F08', 'F12'], async () => {
          const runDirectory = path.join(directory, `${layout}-${mode}-process`);
          const allowedReads = ['synthetic-worker.mjs', 'guard.mjs', 'core.mjs'].map(name => path.join(ROOT, name));
          const fallback = path.join(layout === 'SOURCE' ? moved : stage, 'synthetic-module.mjs');
          allowedReads.push(root, manifestFile, path.join(directory, 'outside.mjs'), fallback);
          const receipt = await supervise({ executable: process.execPath, args: ['--experimental-permission', ...allowedReads.map(filename => `--allow-fs-read=${filename}`), '--disallow-code-generation-from-strings', path.join(ROOT, 'synthetic-worker.mjs'), root, manifestFile, mode, String(manifestIdentity.bytes), manifestIdentity.sha256, fallback], cwd: directory, directory: runDirectory, timeoutMs: mode === 'timeout' ? 1500 : 10000, logBytes: 16384, kind: 'SYNTHETIC_SUPERVISION_CONTROL' });
          await verifyTree(root, entries);
          const stdout = await readFile(path.join(runDirectory, 'stdout.raw'), 'utf8');
          return { reaped: receipt.reaped, timedOut: receipt.timedOut, outputExceeded: receipt.outputExceeded, code: receipt.code, signal: receipt.signal, stdout: mode === 'overflow' ? stdout.slice(0, 20) : stdout };
        }, observation => {
          const result = observation.returned; assert.equal(result?.reaped, true); assert.ok(result.stdout.startsWith('VALID_CONTROL_FIRST\n'));
          if (mode === 'timeout') { assert.equal(result.timedOut, true); assert.ok(['SIGTERM', 'SIGKILL'].includes(result.signal)); }
          else if (mode === 'overflow') assert.equal(result.outputExceeded, true);
          else if (mode === 'ordinary') assert.equal(result.code, 7);
          else {
            assert.equal(result.code, 0);
            const second = JSON.parse(result.stdout.trim().split('\n')[1]);
            if (mode === 'valid') assert.equal(second.status, 'RETURNED');
            else { assert.equal(second.status, 'BOUNDARY'); if (mode === 'eval') assert.equal(second.name, 'EvalError'); else assert.equal(second.code, { denyload: 'DENY_LOAD', sourcefallback: 'DENY_LOAD', builtin: 'DENY_BUILTIN', ambient: 'DENY_AMBIENT' }[mode]); }
          }
        });
      }
    }
    await probe('finite-trace-over-four-mib', ['F11'], async () => {
      const begin = Buffer.from('VALID_CONTROL_FIRST\n');
      const end = Buffer.from(`${JSON.stringify({ status: 'RETURNED', result: { traceBytes: 5242880 } })}\n`);
      const hash = createHash('sha256').update(begin);
      const chunk = Buffer.alloc(65536, 97);
      for (let index = 0; index < 80; index++) hash.update(chunk);
      hash.update(end);
      const expectedBytes = begin.length + 5242880 + end.length;
      const allowedReads = ['synthetic-worker.mjs', 'guard.mjs', 'core.mjs'].map(name => path.join(ROOT, name));
      allowedReads.push(moved, manifestFile);
      const receipt = await supervise({ executable: process.execPath, args: ['--experimental-permission', ...allowedReads.map(filename => `--allow-fs-read=${filename}`), '--disallow-code-generation-from-strings', path.join(ROOT, 'synthetic-worker.mjs'), moved, manifestFile, 'trace', String(manifestIdentity.bytes), manifestIdentity.sha256], cwd: directory, directory: path.join(directory, 'finite-trace-process'), timeoutMs: 10000, logBytes: 16384, traceBytes: expectedBytes, kind: 'FINITE_DECLARED_TRACE_NOT_ORDINARY_PREVIEW' });
      await verifyTree(moved, entries);
      return { reaped: receipt.reaped, code: receipt.code, bytes: receipt.logs[0].bytes, expectedBytes, matching: receipt.logs[0].sha256 === hash.digest('hex'), exceeded: receipt.outputExceeded };
    }, observation => { const result = observation.returned; assert.equal(result?.reaped, true); assert.equal(result.code, 0); assert.equal(result.bytes, result.expectedBytes); assert.equal(result.matching, true); assert.equal(result.exceeded, false); });
    await probe('append-proof-integrity', ['F01'], async () => {
      const root = path.join(directory, 'integrity-control'); await mkdir(root);
      await writeNew(path.join(root, 'known'), 'known'); const known = [{ path: 'known', ...await fingerprint(path.join(root, 'known')) }];
      await verifyTree(root, known); await writeNew(path.join(root, 'new'), 'new');
      await verifyTree(root, known);
    }, throws('UNDECLARED_INPUT'));
    await probe('mode-integrity', ['F01'], async () => {
      const root = path.join(directory, 'mode-control'); await mkdir(root);
      await writeNew(path.join(root, 'known'), 'known'); const known = [{ path: 'known', ...await fingerprint(path.join(root, 'known')) }];
      await chmod(path.join(root, 'known'), 0o755); await verifyTree(root, known);
    }, throws('INPUT_IDENTITY'));
    await probe('traversal-rejection', ['F01'], () => relative('../foreign'), throws('PATH'));
    await probe('symlink-rejection', ['F01'], async () => {
      const root = path.join(directory, 'symlink-control'); await mkdir(root);
      await writeNew(path.join(root, 'target'), 'known');
      await symlink('target', path.join(root, 'link'));
      try { await verifyTree(root, [{ path: 'link', ...await fingerprint(path.join(root, 'target')) }]); }
      finally { await import('node:fs/promises').then(fs => fs.unlink(path.join(root, 'link'))); }
    }, throws('SYMLINK'));
    await probe('hash-diagnostic-identity', ['F01'], async () => {
      const root = path.join(directory, 'hash-control'); await mkdir(root);
      await writeNew(path.join(root, 'known'), 'known');
      const original = await fingerprint(path.join(root, 'known'));
      const expected = { path: 'known', ...original, sha256: '0'.repeat(64) };
      try { await verifyTree(root, [expected]); }
      catch (error) { return { code: error.code, exact: error.message === `INPUT_IDENTITY: known: expected sha256=${expected.sha256} bytes=5 mode=644; actual sha256=${original.sha256} bytes=5 mode=644` }; }
    }, equals({ code: 'INPUT_IDENTITY', exact: true }));
    await probe('missing-input-rejection', ['F01'], () => verifyTree(stage, [{ ...entries[0], path: 'missing.mjs' }]), throws('ENOENT'));
    await probe('empty-directory-append-rejection', ['F01'], async () => {
      const root = path.join(directory, 'directory-control'); await mkdir(root);
      await writeNew(path.join(root, 'known'), 'known'); const known = [{ path: 'known', ...await fingerprint(path.join(root, 'known')) }];
      await mkdir(path.join(root, 'unexpected')); await verifyTree(root, known);
    }, throws('UNDECLARED_DIRECTORY'));
    await verifySeal();
    check(JSON.stringify(results.map(row => row.id).sort()) === JSON.stringify([...seal.plannedProbeIds].sort()), 'QUALIFICATION_INVENTORY');
  } catch (error) {
    await writeNew(path.join(directory, 'STOP.json'), { code: error.code ?? null, name: error.name, message: String(error.message).slice(0, 1024), automaticRetry: false });
    process.exitCode = 1;
  } finally {
    const summary = { classification: 'SYNTHETIC_QUALIFICATION_ONLY', started: preRun.started, ended: new Date().toISOString(), recipeCommit, results, planned: seal.plannedProbeIds.length, unrun: seal.plannedProbeIds.filter(id => !results.some(row => row.id === id)), qualified: results.filter(row => row.status === 'QUALIFIED_HELPER_ONLY').length, failed: results.filter(row => row.status === 'FAILED_QUALIFICATION').length, interrupted: process.exitCode === 1, familiesWithPartialHelperControls: [...new Set(results.filter(row => row.status === 'QUALIFIED_HELPER_ONLY').flatMap(row => row.families))].sort(), genericCapCountersQualified: results.filter(row => row.id.startsWith('cap-') && row.status === 'QUALIFIED_HELPER_ONLY').length, product: 0, implementationInspection: 0, nativeOracle: 0, defaultScaleProductCaps: 0, publicSettlementProof: false, noRetry: true };
    await writeNew(path.join(directory, 'RESULT.json'), summary);
    const completeInventory = await inventory(directory);
    const files = completeInventory.filter(entry => !entry.directory);
    await writeNew(path.join(directory, 'EVIDENCE-MANIFEST.json'), { classification: 'READ_ONLY_VERIFICATION_MANIFEST', files, directories: completeInventory.filter(entry => entry.directory).map(entry => entry.path).sort(), entryCount: files.length, detectsNewEntries: true, excludesSelfOnly: true });
    process.stdout.write(`synthetic qualified=${summary.qualified} failed=${summary.failed} interrupted=${summary.interrupted}\n${path.join(directory, 'RESULT.json')}\n`);
  }
}
