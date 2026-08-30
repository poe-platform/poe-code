import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export async function supervise(executable, args, options = {}) {
  const { cwd, env, timeoutMs = 30000, maxBytes = 256 * 1024 } = options;
  const started = new Date().toISOString();
  const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', bytes = 0, failure = null, spawnError = null, killer;
  const stdoutDecoder = new StringDecoder('utf8'), stderrDecoder = new StringDecoder('utf8');
  const stop = reason => {
    if (failure) return;
    failure = reason;
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    killer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 250);
  };
  const timer = setTimeout(() => stop('deadline'), timeoutMs);
  child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes <= maxBytes) stdout += stdoutDecoder.write(chunk); else stop('output-ceiling'); });
  child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes <= maxBytes) stderr += stderrDecoder.write(chunk); else stop('output-ceiling'); });
  child.on('error', error => { spawnError = error.message; });
  const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(timer); clearTimeout(killer);
  stdout += stdoutDecoder.end(); stderr += stderrDecoder.end();
  let groupAbsent = true;
  if (child.pid) {
    try { process.kill(-child.pid, 0); groupAbsent = false; } catch (error) { assert.equal(error.code, 'ESRCH'); }
    if (!groupAbsent) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      for (let attempt = 0; attempt < 20 && !groupAbsent; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        try { process.kill(-child.pid, 0); } catch (error) { assert.equal(error.code, 'ESRCH'); groupAbsent = true; }
      }
      failure ??= 'descendant-survived-close';
    }
  }
  return { executable, args, cwd, started, finished: new Date().toISOString(), pid: child.pid, ...result, spawnError, failure, groupAbsent, closeObserved: true, stdout, stderr, bytes };
}

export function classify(run, expectedIds, options = {}) {
  const errors = [], observations = [], loads = [], summaries = [], activations = [];
  for (const line of run.stdout.split('\n').filter(Boolean)) {
    let row;
    try { row = JSON.parse(line); } catch { errors.push('non-JSON stdout'); continue; }
    if (row === null || typeof row !== 'object' || Array.isArray(row)) { errors.push('non-object receipt'); continue; }
    if (row.observation) observations.push(row.observation);
    else if (row.load) loads.push(row.load);
    else if (row.activation) activations.push(row.activation);
    else if (row.summary || Object.hasOwn(row, 'cases')) summaries.push(row.summary ?? row);
    else if (!row.admission && !row.diagnostic) errors.push('unrecognized receipt');
  }
  if (!run.closeObserved || !run.groupAbsent || run.spawnError || run.failure || run.signal) errors.push('child not naturally reaped');
  const ids = observations.map(row => row.id);
  if (ids.length !== expectedIds.length || new Set(ids).size !== ids.length || !expectedIds.every(id => ids.includes(id))) errors.push('missing/duplicate/unexpected observation');
  if (summaries.length !== 1) errors.push('missing/duplicate summary');
  const failed = observations.filter(row => row.pass !== true).map(row => row.id);
  const passed = observations.length - failed.length;
  const summary = summaries[0];
  if (summary && (summary.cases !== expectedIds.length || summary.pass !== passed || !Array.isArray(summary.failed) || JSON.stringify([...(summary.failed ?? [])].sort()) !== JSON.stringify([...failed].sort()))) errors.push('summary does not reconcile');
  if (observations.some(row => row.settled !== true || row.disposed !== true)) errors.push('observation not settled/disposed');
  if (run.code !== (failed.length ? 1 : 0)) errors.push('exit status contradicts body outcomes');
  if (options.modulePath && !loads.some(row => row.path === options.modulePath && row.sha256 === options.moduleSha256)) errors.push('required actual runtime load missing');
  if (options.mutantId && !activations.some(row => row.id === options.mutantId && Number.isSafeInteger(row.hits) && row.hits > 0)) errors.push('mutant mechanism not activated');
  if (options.requiredFailed?.some(id => !failed.includes(id))) errors.push('designated mutant predicate not rejected');
  const coherent = errors.length === 0;
  return { coherent, accepted: coherent && failed.length === 0, mutantKilled: coherent && failed.length > 0 && Boolean(options.requiredFailed?.length), expected: expectedIds.length, observed: observations.length, passed, failed, errors, observations, loads, activations, summary };
}

