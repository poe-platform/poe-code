import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize, harnessIdentity, claimExecution } from './authorization.mjs';
import { directory, digest, verifySeal } from './seal.mjs';
import { evaluate } from './oracle.mjs';

export function inspectPreparation() {
  const sealed = verifySeal();
  return { cases: sealed.cases.map(entry => ({ id: entry.id, sha256: digest(JSON.stringify(entry)), proof: entry.expected.proof,
    fixtureEntries: entry.entries.length, fileBytes: entry.entries.reduce((total, item) => total + (item.base64 ? Buffer.from(item.base64, 'base64').length : 0), 0),
    targetCodeUnits: entry.entries.reduce((total, item) => total + (item.target?.length ?? 0), 0),
    distinctFilePayloads: new Set(entry.entries.filter(item => item.type === 'file').map(item => item.base64)).size })),
    presealSha256: digest(readFileSync(join(directory, 'SEAL.json'))), harness: harnessIdentity(), caps: sealed.caps, productExecutions: 0 };
}

async function execute(authPath, authHash, output) {
  const authorized = authorize(authPath, authHash);
  assert(isAbsolute(output ?? '') && (output.startsWith('/tmp/') || output.startsWith('/private/tmp/')), 'Fresh explicit owned /tmp output directory required');
  mkdirSync(output);
  claimExecution(authorized, authHash);
  const { sealed, approval } = authorized;
  const started = Date.now();
  const rows = [];
  let interrupted = false;
  let activeChild;
  let spawnedChildren = 0;
  const interrupt = () => { interrupted = true; activeChild?.kill('SIGKILL'); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    for (const entry of sealed.cases) {
      if (interrupted || Date.now() - started >= sealed.caps.wholeWallMs) { rows.push({ id: entry.id, status: 'not-run', reason: 'whole-batch stop' }); continue; }
      const proof = approval.proofs[entry.expected.proof];
      if (proof.status !== 'approved') { rows.push({ id: entry.id, status: 'HOLD', productInvocations: 0, reason: proof.basis }); continue; }
      const record = await new Promise(resolveChild => {
        const rawOut = [];
        const rawErr = [];
        let transportBytes = 0;
        let observedRss = 0;
        let observedCommandStarts = 0;
        let stopped;
        let report;
        const remaining = sealed.caps.wholeWallMs - (Date.now() - started);
        assert(++spawnedChildren <= 2, 'Exactly two correction children at most; never replay the four prior rows');
        const child = fork(join(directory, 'child.mjs'), [], { silent: true,
          execArgv: ['--max-heap-size=128', '--experimental-loader', join(directory, 'loader.mjs')],
          env: { SAFETY_AUTH: authPath, SAFETY_AUTH_SHA256: authHash, SAFETY_CASE: entry.id, SAFETY_RUN_NONCE: randomBytes(16).toString('hex'), SAFETY_MODULE_LOG: join(output, `${entry.id}.modules.jsonl`) } });
        activeChild = child;
        const stop = reason => { stopped ??= reason; child.kill('SIGKILL'); };
        const watchdog = setTimeout(() => stop(remaining < sealed.caps.childWallMs ? 'whole-wall-cap' : 'child-wall-cap'), Math.min(remaining, sealed.caps.childWallMs));
        const collect = target => chunk => {
          transportBytes += chunk.length;
          if (transportBytes + (report?.stdoutBytes ?? 0) + (report?.stderrBytes ?? 0) > sealed.caps.captureBytes) { stop('combined-capture-cap'); return; }
          target.push(chunk);
        };
        child.stdout.on('data', collect(rawOut));
        child.stderr.on('data', collect(rawErr));
        child.on('message', message => {
          if (Buffer.byteLength(JSON.stringify(message)) > sealed.caps.ipcBytes) { stop('ipc-cap'); return; }
          if (message.kind === 'command-start') {
            if (message.id !== entry.id || ++observedCommandStarts > 1) stop('unexpected-command-start');
          } else if (message.kind === 'rss') {
            observedRss = Math.max(observedRss, message.bytes);
            if (observedRss > sealed.caps.observedRssBytes) stop('observed-rss-cap');
          } else if (message.kind === 'result') {
            if (report) stop('duplicate-result');
            report = message.report;
            if (transportBytes + report.stdoutBytes + report.stderrBytes > sealed.caps.captureBytes) stop('combined-capture-cap');
          } else stop('unknown-child-message');
        });
        child.on('error', error => { stopped ??= error.message; });
        child.on('close', (code, signal) => {
          clearTimeout(watchdog);
          activeChild = undefined;
          writeFileSync(join(output, `${entry.id}.stdout.txt`), Buffer.concat(rawOut), { flag: 'wx' });
          writeFileSync(join(output, `${entry.id}.stderr.txt`), Buffer.concat(rawErr), { flag: 'wx' });
          resolveChild({ id: entry.id, pid: child.pid, childCode: code, signal, stopped, observedRss, observedCommandStarts, report });
        });
      });
      if (record.stopped || record.childCode !== 0 || !record.report) rows.push({ ...record, status: 'fail', reason: record.stopped ?? 'child did not complete' });
      else {
        try { assert.equal(record.observedCommandStarts, 1); rows.push({ ...record, ...evaluate(entry, record.report), staticProof: proof }); }
        catch (error) { rows.push({ ...record, status: 'fail', reason: error.message, staticProof: proof }); }
      }
      writeFileSync(join(output, `${entry.id}.json`), `${JSON.stringify(rows.at(-1), null, 2)}\n`, { flag: 'wx' });
    }
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    activeChild?.kill('SIGKILL');
  }
  const summary = { sourceCommit: approval.sourceCommit, authorizationSha256: authHash, preparation: inspectPreparation(), startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), rows,
    childStarts: rows.filter(row => row.pid !== undefined).length, observedCommandStarts: rows.reduce((total, row) => total + (row.observedCommandStarts ?? 0), 0),
    previousProductInvocations: 4, maximumNewProductInvocations: 2, reuseWithoutRerun: approval.reuseWithoutRerun, previousRun: approval.previousRun,
    incompleteChildrenHaveUnknownFinalProductEffects: rows.some(row => row.pid !== undefined && !row.report), nativeCalls: 0, retries: 0 };
  writeFileSync(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, rows: rows.map(({ id, status }) => ({ id, status })) }));
  if (rows.some(row => row.status !== 'pass')) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length === 3 && process.argv[2] === '--check') console.log(JSON.stringify(inspectPreparation(), null, 2));
  else {
    assert.equal(process.argv.length, 6, 'Use --check, or --execute ROOT_AUTH ABSOLUTE_AUTH_SHA256 FRESH_TMP_OUTPUT');
    assert.equal(process.argv[2], '--execute');
    await execute(process.argv[3], process.argv[4], process.argv[5]);
  }
}
