import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from './prepare.mjs';

const text = value => Buffer.from(value, 'base64').toString();
const deferred = () => { let resolve; let reject; const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; }); return { promise, resolve, reject }; };
const chain = count => Array.from({ length: count }, () => '1').flatMap((token, index) => index ? ['+', token] : [token]);

export async function controls(bound, state) {
  const specs = load(join(state.frozen, 'controls.json'));
  const cases = [];
  const unhandled = [];
  const listener = reason => unhandled.push(String(reason));
  process.on('unhandledRejection', listener);
  async function check(id, specification, operation) {
    const start = bound.records.length;
    try {
      const detail = await operation();
      cases.push({ id, specification, status: 'PASS', detail: detail ?? null, observations: bound.records.slice(start) });
    } catch (error) {
      cases.push({ id, specification, status: 'FAIL', error: String(error), observations: bound.records.slice(start) });
    }
  }
  const success = (row, expected, status = 0) => {
    assert.equal(row.failure, null);
    assert.equal(row.status, status);
    assert.equal(text(row.stdoutBase64), expected);
    assert.equal(row.stderrBase64, '');
  };
  const refused = (row, message) => {
    assert.equal(row.failure, null);
    assert.equal(row.status, 3);
    assert.equal(row.stdoutBase64, '');
    assert(text(row.stderrBase64).includes(message), text(row.stderrBase64));
    assert(Buffer.from(row.stderrBase64, 'base64').length <= 128);
  };
  for (const source of ['implicit', 'explicit', 'binary', 'never-ending']) {
    for (const args of specs.controls.find(entry => entry.id === 'direct-zero-stdin-reads').inputs) {
      await check(`stdin-${source}-${JSON.stringify(args)}`, 'direct-zero-stdin-reads', async () => {
        const row = await bound.direct(args, {}, { stdinIsDefault: source === 'implicit', stdinKind: source });
        assert.deepEqual(row.counters, { stdinGetter: 0, iterator: 0, next: 0, return: 0, throw: 0, fs: 0, invoke: 0, cleanup: 0 });
        if (args[0] === '41') success(row, '42\n');
        else if (args[0] === '0') success(row, '0\n', 1);
        else if (args[0] === 'abc') refused(row, 'BRE protocol is pending');
        else { assert.equal(row.status, 2); assert.equal(row.stdoutBase64, ''); }
        return { source, nativeMeaning: args[0] === 'abc' ? 'NOT READY — evaluated regex still status 3, no regex semantic pass' : 'bounded nonregex result', frozenContext: true };
      });
    }
  }
  for (const sink of ['stdout', 'stderr']) {
    await check(`backpressure-${sink}`, 'await-stdout-backpressure', async () => {
      const admitted = deferred();
      const gate = deferred();
      let settled = false;
      let active = 0;
      let maximum = 0;
      const promise = bound.direct(sink === 'stdout' ? ['41', '+', '1'] : ['1', '+'], {}, { [sink]: async () => { maximum = Math.max(maximum, ++active); admitted.resolve(); await gate.promise; active--; } }).then(row => { settled = true; return row; });
      await admitted.promise;
      await turn();
      const early = settled;
      gate.resolve();
      const row = await promise;
      assert.equal(early, false);
      assert.equal(maximum, 1);
      assert.equal(active, 0);
      if (sink === 'stdout') success(row, '42\n');
      else assert.equal(row.status, 2);
      return { settledBeforeRelease: early, maximumConcurrentWrites: maximum, retainedByteOwnership: true };
    });
  }
  await check('sink-rejection-observation', 'sink-rejection', async () => {
    const stdoutReason = { sink: 'stdout' };
    const stderrReason = { sink: 'stderr' };
    let stdoutCalls = 0;
    let stderrCalls = 0;
    const converted = await bound.direct(['41', '+', '1'], {}, { stdout: async () => { stdoutCalls++; throw stdoutReason; } });
    assert.equal(converted.status, 3);
    assert.equal(text(converted.stderrBase64), 'expr: execution or output failure\n');
    const rejected = await bound.direct(['1', '+'], {}, { stderr: async () => { stderrCalls++; throw stderrReason; } });
    assert.equal(rejected.rejection, stderrReason);
    const both = await bound.direct(['41', '+', '1'], {}, { stdout: async () => { stdoutCalls++; throw stdoutReason; }, stderr: async () => { stderrCalls++; throw stderrReason; } });
    assert.equal(both.rejection, stderrReason);
    assert.equal(stdoutCalls, 2);
    assert.equal(stderrCalls, 2);
    return { stdoutRejection: 'converted to explicit nonzero utility status 3; not success and not sentinel propagation', stderrRejection: 'exact sentinel preserved', bothRejection: 'stderr sentinel preserved', admittedBytesAreNotCompletedWrites: true, retries: 0 };
  });
  const reasons = [{ kind: 'caller-object' }, 'caller-primitive', Object.assign(new Error('caller errno-shaped'), { code: 'EIO' })];
  for (const [index, reason] of reasons.entries()) {
    await check(`preabort-${index}`, 'preabort-and-midflight', async () => {
      const controller = new AbortController();
      controller.abort(reason);
      const row = await bound.direct(['41', '+', '1'], {}, { signal: controller.signal });
      assert.equal(row.rejection, reason);
      assert.equal(row.stdoutBase64, '');
      assert.equal(row.stderrBase64, '');
      assert.equal(row.counters.stdinGetter, 0);
      const shell = bound.shell();
      try { await assert.rejects(shell.exec('expr 41 + 1', { signal: controller.signal }), error => error === reason); }
      finally { await shell.dispose(); }
      return { directAndPublicReasonIdentity: true };
    });
    await check(`output-abort-${index}`, 'preabort-and-midflight', async () => {
      const controller = new AbortController();
      const admitted = deferred();
      const opaque = deferred();
      const shell = bound.shell();
      try {
        const pending = shell.exec('expr 41 + 1', { signal: controller.signal, stdout: { write() { admitted.resolve(); return opaque.promise; } } });
        const outcome = pending.then(value => ({ value }), error => ({ error }));
        await admitted.promise;
        controller.abort(reason);
        const actual = await outcome;
        assert.equal(actual.error, reason);
        opaque.reject({ lateOpaqueSink: index });
        await turn();
        await turn();
      } finally { opaque.resolve(); await shell.dispose(); }
      return { exactPublicReason: true, uncooperativeWriteNotAwaited: true, lateRejectionObserved: true, completedEffectsNotRolledBack: true };
    });
  }
  await check('cooperative-evaluation-abort', 'preabort-and-midflight', async () => {
    const controller = new AbortController();
    const reason = { during: 'index evaluation' };
    const pending = bound.direct(['index', 'a'.repeat(2000), 'b'.repeat(100)], {}, { signal: controller.signal });
    const timer = setImmediate(() => controller.abort(reason));
    const row = await pending;
    clearImmediate(timer);
    assert.equal(row.rejection, reason);
    assert.equal(row.stdoutBase64, '');
    return { cancellationPoint: 'bounded index loop cooperative yield' };
  });
  await check('no-resource-cleanup-siblings-dispose', 'cleanup-ownership', async () => {
    const first = bound.shell();
    const second = bound.shell();
    const admitted = deferred();
    const held = deferred();
    try {
      const firstResult = first.exec('expr 41 + 1', { stdout: { write() { admitted.resolve(); return held.promise; } } }).then(value => ({ value }), error => ({ error: String(error) }));
      await admitted.promise;
      const sameShellSibling = await first.exec('expr 7 + 1');
      assert.equal(sameShellSibling.stdout, '8\n');
      const sibling = await second.exec('expr 41 + 1');
      assert.equal(sibling.stdout, '42\n');
      const disposals = [first.dispose(), first.dispose()];
      await Promise.all(disposals);
      const cancelled = await firstResult;
      held.reject({ lateAfterDispose: true });
      await turn();
      assert.equal((await second.exec('expr 41 + 1')).stdout, '42\n');
      return { cancelled, repeatedDisposeSettled: true, sameShellSiblingCompleted: true, secondShellSurvived: true, invocationOwnedRegexResources: 0, cleanupRegistration: 'not applicable to no-resource baseline; required regex lease/admission control NOT READY' };
    } finally { held.resolve(); await first.dispose(); await second.dispose(); }
  });
  for (const size of [15, 16, 17]) {
    for (const shape of ['ascii', 'utf8']) {
      await check(`argument-bytes-${shape}-${size}`, 'arg-byte-boundary', async () => {
        const token = shape === 'ascii' ? 'a'.repeat(size - 1) : 'é'.repeat(Math.floor((size - 1) / 2)) + 'a'.repeat((size - 1) % 2);
        const args = ['+', token];
        assert.equal(args.reduce((sum, value) => sum + Buffer.byteLength(value), 0), size);
        const row = await bound.direct(args, { limits: { maxArgumentBytes: 16 } });
        if (size <= 16) success(row, `${token}\n`); else refused(row, 'aggregate argument bytes');
        return { bytes: size, convention: 'sum UTF-8 bytes, no terminators/separators' };
      });
    }
  }
  await check('argument-skipped-preflight', 'arg-byte-boundary', async () => {
    const row = await bound.direct(['kept', '|', '+', 'x'.repeat(17)], { limits: { maxArgumentBytes: 16 } });
    refused(row, 'aggregate argument bytes');
  });
  for (const count of [15, 16, 17]) {
    await check(`argument-count-${count}`, 'arg-byte-boundary', async () => {
      const row = await bound.direct(Array(count).fill('x'), { limits: { maxNodes: 4 } });
      if (count <= 16) { assert.equal(row.status, 2); assert(text(row.stderrBase64).includes('unexpected argument')); }
      else refused(row, 'argument count');
      return { argumentCount: count, cap: '4 * maxNodes = 16; below/at reach syntax error, above refuses preparse' };
    });
  }
  for (const digits of [7, 8, 9]) {
    for (const shape of ['positive', 'negative', 'zero-padded']) {
      await check(`digits-${shape}-${digits}`, 'digit-boundary', async () => {
        const token = shape === 'negative' ? `-${'1'.repeat(digits)}` : shape === 'zero-padded' ? `${'0'.repeat(digits - 1)}1` : '1'.repeat(digits);
        const row = await bound.direct([token, '+', '0'], { limits: { maxNumericDigits: 8 } });
        if (digits <= 8) success(row, `${BigInt(token)}\n`); else refused(row, 'numeric digits');
        return { rawDigits: digits, signExcluded: true, zerosCounted: true };
      });
    }
  }
  await check('digits-128-and-product-growth', 'digit-boundary', async () => {
    const token = '9'.repeat(128);
    success(await bound.direct([token, '+', '1']), `${BigInt(token) + 1n}\n`);
    refused(await bound.direct(['9999', '*', '9999'], { limits: { maxNumericDigits: 4 } }), 'arithmetic result digits');
    success(await bound.direct(['kept', '|', '9'.repeat(20), '+', '1'], { limits: { maxNumericDigits: 4 } }), 'kept\n');
  });
  for (const nodes of [8, 9, 10]) {
    for (const skipped of [false, true]) {
      await check(`nodes-${nodes}-skipped-${skipped}`, 'node-boundary', async () => {
        const target = nodes - (skipped ? 2 : 0);
        const args = target % 2 ? chain((target + 1) / 2) : ['length', ...chain(target / 2)];
        const whole = skipped ? ['kept', '|', ...args] : args;
        const row = await bound.direct(whole, { limits: { maxNodes: 9 } });
        if (nodes <= 9) success(row, skipped ? 'kept\n' : `${Math.ceil(target / 2)}\n`); else refused(row, 'AST node');
        return { actualASTNodes: nodes, cap: 9, literalAndOperatorEachOneNode: true, parenthesesDoNotCreateNodes: true };
      });
    }
  }
  for (const depth of [7, 8, 9]) {
    for (const shape of ['grouping', 'prefix']) {
      await check(`depth-${shape}-${depth}`, 'depth-boundary', async () => {
        const args = shape === 'grouping' ? [...Array(depth - 1).fill('('), '1', ...Array(depth - 1).fill(')')] : [...Array(depth - 1).fill('length'), '1'];
        const row = await bound.direct(args, { limits: { maxDepth: 8 } });
        if (depth <= 8) success(row, '1\n'); else refused(row, 'depth');
        return { depth, cap: 8, parserRootDepth: 1, groupingAddsParserDepthNotASTNode: true };
      });
    }
  }
  await check('depth-skipped-unclosed', 'depth-boundary', async () => {
    const row = await bound.direct(['kept', '|', '(', '1'], { limits: { maxDepth: 8 } });
    assert.equal(row.status, 2);
    assert(text(row.stderrBase64).includes("expecting ')'"));
  });
  for (const maximum of [8, 9, 10]) {
    await check(`work-literal-${maximum}`, 'work-boundary', async () => {
      const row = await bound.direct(['x'], { limits: { maxSteps: maximum } });
      if (maximum < 9) refused(row, 'evaluation work'); else success(row, 'x\n');
      return { requiredWork: 9, ledger: { argvTokenAndUtf16: 2, node: 1, evaluationYield: 1, allocation: 1, truth: 1, output: 2, finalYield: 1 } };
    });
  }
  await check('work-aggregate-arithmetic-index-skips', 'work-boundary', async () => {
    const repeated = chain(12);
    success(await bound.direct(repeated, { limits: { maxSteps: 10000 } }), '12\n');
    refused(await bound.direct(repeated, { limits: { maxSteps: 100 } }), 'evaluation work');
    refused(await bound.direct(['index', 'a'.repeat(50), 'b'.repeat(50)], { limits: { maxSteps: 1000 } }), 'evaluation work');
    success(await bound.direct(['kept', '|', '1', '/', '0']), 'kept\n');
    const shell = bound.shell({ limits: { maxCommands: 2 } });
    try { await assert.rejects(shell.exec('expr 1; expr 2; expr 3'), error => error.limit === 'maxCommands'); }
    finally { await shell.dispose(); }
    const nested = bound.shell({ limits: { maxCommands: 2 } });
    nested.register({ name: 'independent-invoke', async execute(context) { await context.invoke('expr', ['1']); return context.invoke('expr', ['2']); } });
    try { await assert.rejects(nested.exec('independent-invoke'), error => error.limit === 'maxCommands'); }
    finally { await nested.dispose(); }
    return { workAggregate: true, shellCommandBudgetNotReset: true, nestedLiteralInvokeBudgetNotReset: true, familyWorkDistinctFromShellCommandBudget: true, evaluatedRegexWork: 'NOT READY' };
  });
  for (const size of [7, 8, 9]) {
    await check(`string-bytes-${size}`, 'arg-byte-boundary/work-boundary', async () => {
      const row = await bound.direct(['+', 'x'.repeat(size)], { limits: { maxStringBytes: 8 } });
      if (size <= 8) success(row, `${'x'.repeat(size)}\n`); else refused(row, 'string allocation');
      return { stringAllocationBytes: size, cap: 8 };
    });
    await check(`output-bytes-${size}`, 'output-boundary', async () => {
      const row = await bound.direct(['+', 'x'.repeat(size - 1)], { limits: { maxOutputBytes: 8 } });
      if (size <= 8) success(row, `${'x'.repeat(size - 1)}\n`); else refused(row, 'output bytes');
      return { includesLF: true, stdoutByteCount: size };
    });
  }
  await check('output-long-integer-and-shell-aggregate', 'output-boundary', async () => {
    const args = ['9'.repeat(128), '+', '1'];
    success(await bound.direct(args, { limits: { maxOutputBytes: 130 } }), `1${'0'.repeat(128)}\n`);
    refused(await bound.direct(args, { limits: { maxOutputBytes: 129 } }), 'output bytes');
    const shell = bound.shell({ limits: { maxOutputBytes: 5 } });
    try { await assert.rejects(shell.exec('expr 41 + 1; expr 41 + 1'), error => error.limit === 'maxOutputBytes'); }
    finally { await shell.dispose(); }
    return { aggregateShellOutputRefused: true, diagnosticsBoundedSeparately: true, regexCaptureOutput: 'NOT READY' };
  });
  await check('unicode-policy-not-oracle-substitution', 'unicode-contract', async () => {
    success(await bound.direct(['length', 'Aé😀é'], {}, { env: { LC_ALL: 'C.UTF-8' } }), '5\n');
    success(await bound.direct(['substr', 'Aé😀Z', '3', '1'], {}, { env: { LC_ALL: 'C.UTF-8' } }), '😀\n');
    for (const args of [['length', '\ud800'], ['length', '\udc00'], ['+', 'a\0b']]) {
      const row = await bound.direct(args);
      assert.equal(row.status, 2);
      assert.equal(row.stdoutBase64, '');
      assert(text(row.stderrBase64).includes(args[1].includes('\0') ? 'NUL' : 'well-formed Unicode'));
    }
    return { policy: 'C/POSIX bytes; C.UTF-8/C.utf8 scalars; en_US.UTF-8 unsupported for character operations and collation', nativeOracleSubstituted: false, originalSurrogatesAndNULNotSpawned: true, arbitraryInvalidUtf8Argv: 'UNMEASURED' };
  });
  await check('literal-no-host-effects', 'no-host-effects', async () => {
    const token = '$(touch NEVER); * > /not-a-file';
    const row = await bound.direct(['+', token]);
    success(row, `${token}\n`);
    assert.equal(row.counters.fs, 0);
    assert.equal(row.counters.invoke, 0);
    return { argvNeverEvaluatedAsShell: true, directFSCalls: 0, directInvokeCalls: 0, proxyIsNotHostJavaScriptSandboxProof: true };
  });
  const workflows = [];
  const oracle = load(join(state.frozen, 'evidence/original-20260827/oracle.json'));
  const gnu = oracle.profiles.find(profile => profile.id === 'gnu-9.7-darwin-C');
  for (const workflow of specs.shellWorkflows) {
    const fs = new bound.api.MemoryFileSystem();
    const shell = bound.shell({ fs });
    try {
      const result = await shell.exec(workflow.script);
      const expectedStderr = workflow.stderrFromGnuCase ? text(gnu.results.find(row => row.id === workflow.stderrFromGnuCase).stderrBase64) : workflow.stderr;
      const files = {};
      for (const path of Object.keys(workflow.vfsFiles ?? {})) files[path] = text(Buffer.from(await fs.readFile(path)).toString('base64'));
      const strict = result.stdout === workflow.stdout && result.stderr === expectedStderr && result.exitCode === workflow.exitCode && JSON.stringify(files) === JSON.stringify(workflow.vfsFiles ?? {});
      workflows.push({ ...workflow, expectedStderr, observed: { stdoutBase64: Buffer.from(result.stdoutBytes).toString('base64'), stderrBase64: Buffer.from(result.stderrBytes).toString('base64'), exitCode: result.exitCode, vfsFiles: files }, status: strict ? 'PASS' : 'FAIL', classification: result.stderr.includes('BRE protocol is pending') ? 'known-pending-regex-status3-upstream' : strict ? 'exact' : 'baseline-workflow-defect' });
    } catch (error) { workflows.push({ ...workflow, status: 'FAIL', failure: String(error) }); }
    finally { await shell.dispose(); }
  }
  const regexObservations = [];
  for (const input of [...specs.controls.find(entry => entry.id === 'bounded-redos').inputs, ...specs.controls.find(entry => entry.id === 'short-circuit-worker-admission').inputs.map(argv => ({ argv }))]) {
    const worker = new Worker(new URL('./regex-probe.mjs', import.meta.url), { execArgv: [], workerData: { installed: state.installed, argv: input.argv }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    const exit = new Promise(resolve => worker.once('exit', code => resolve(code)));
    let heartbeat = 0;
    const beat = setInterval(() => heartbeat++, 5);
    let timeout;
    try {
      const message = once(worker, 'message').then(([value]) => value);
      const watchdog = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('outer REQUIRED watchdog expired')), 2000); });
      const observed = await Promise.race([message, watchdog]);
      regexObservations.push({ argv: input.argv, status: 'NOT READY', observed, heartbeat, reason: 'baseline has no product compile/match service; refusal or skipped branch is NOT regex safety acceptance' });
    } catch (error) { regexObservations.push({ argv: input.argv, status: 'FAIL', failure: String(error), heartbeat }); }
    finally { clearTimeout(timeout); clearInterval(beat); await worker.terminate(); await exit; }
  }
  await turn();
  await delay(5);
  process.removeListener('unhandledRejection', listener);
  const controlCoverage = specs.controls.map(specification => ({ id: specification.id, measurements: cases.filter(entry => entry.specification.includes(specification.id)).map(entry => entry.id), state: ['required-regex-worker', 'bounded-redos', 'short-circuit-worker-admission'].includes(specification.id) ? 'NOT READY' : ['preabort-and-midflight', 'cleanup-ownership', 'work-boundary', 'output-boundary'].includes(specification.id) ? 'BASELINE PORTION MEASURED; regex portion NOT READY' : 'BASELINE PORTION MEASURED', frozenRequirementPreserved: specification }));
  return { cases, workflows, regexObservations, controlCoverage, unhandledRejections: unhandled, workers: { created: regexObservations.length, terminatedAndExitAwaited: regexObservations.length }, fullFrozenControlsAccepted: false, measurements: { pass: cases.filter(entry => entry.status === 'PASS').length, fail: cases.filter(entry => entry.status === 'FAIL').length, workflowsPass: workflows.filter(entry => entry.status === 'PASS').length, workflowsTotal: workflows.length, regexSafetyPass: 0 } };
}
