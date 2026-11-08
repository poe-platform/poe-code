import { spawn } from 'node:child_process';

export async function supervise(executable, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;
  const maxBytes = options.maxBytes ?? 262144;
  const started = new Date().toISOString();
  const child = spawn(executable, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = { stdout: [], stderr: [] }; let bytes = 0; let fault = null; let spawnError = null;
  let closeObserved = false; let code = null; let signal = null; let killTimer; let hardTimer;
  const terminate = reason => {
    fault ??= reason;
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') fault = 'terminate-failed'; } }
    killTimer ??= setTimeout(() => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') fault = 'kill-failed'; } } }, 200);
  };
  for (const channel of ['stdout', 'stderr']) child[channel].on('data', chunk => {
    bytes += chunk.length;
    if (bytes <= maxBytes) chunks[channel].push(Buffer.from(chunk));
    else terminate('output-ceiling');
  });
  child.on('error', error => { spawnError = String(error); });
  const timer = setTimeout(() => terminate('deadline'), timeoutMs);
  await new Promise(resolve => {
    child.once('close', (status, terminatedBy) => { closeObserved = true; code = status; signal = terminatedBy; resolve(); });
    hardTimer = setTimeout(() => { terminate('close-not-observed'); resolve(); }, timeoutMs + 2000);
  });
  clearTimeout(timer); clearTimeout(killTimer); clearTimeout(hardTimer);
  let groupAbsent = !child.pid;
  if (child.pid) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try { process.kill(-child.pid, 0); }
      catch (error) { if (error.code === 'ESRCH') { groupAbsent = true; break; } fault ??= 'group-probe-failed'; }
      fault ??= 'survived-close';
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') fault ??= 'group-kill-failed'; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  return { executable, args, started, finished: new Date().toISOString(), pid: child.pid ?? null,
    code, signal, closeObserved, groupAbsent, spawnError, fault, bytes,
    stdout: Buffer.concat(chunks.stdout).toString('utf8'), stderr: Buffer.concat(chunks.stderr).toString('utf8') };
}

export function classify(run, ids, requirements = {}) {
  const observations = []; const summaries = []; const loads = []; const activations = []; const errors = [];
  if (!ids.length || new Set(ids).size !== ids.length) errors.push('empty or duplicate requested IDs');
  if (!run.closeObserved || !run.groupAbsent || run.spawnError || run.fault || run.signal) errors.push('unsafe child lifecycle');
  for (const text of run.stdout.split('\n').filter(Boolean)) {
    let entry; try { entry = JSON.parse(text); } catch { errors.push('invalid receipt JSON'); continue; }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push('invalid receipt object'); continue; }
    if (entry.observation) observations.push(entry.observation);
    else if (entry.summary) summaries.push(entry.summary);
    else if (entry.load) loads.push(entry.load);
    else if (entry.activation) activations.push(entry.activation);
    else if (!entry.admission && !entry.diagnostic) errors.push('unknown receipt');
  }
  if (JSON.stringify(observations.map(row => row.id)) !== JSON.stringify(ids)) errors.push('missing/duplicate/reordered observations');
  if (observations.some(row => typeof row.pass !== 'boolean' || row.settled !== true || row.disposed !== true)) errors.push('unsettled or invalid observation');
  const failed = observations.filter(row => row.pass === false).map(row => row.id);
  if (summaries.length !== 1 || summaries[0].cases !== ids.length || summaries[0].pass !== ids.length - failed.length || JSON.stringify(summaries[0].failed) !== JSON.stringify(failed)) errors.push('summary mismatch');
  if (run.code !== (failed.length ? 1 : 0)) errors.push('exit contradicts body outcomes');
  for (const expected of requirements.loads ?? []) if (!loads.some(load => load.path === expected.path && load.sha256 === expected.sha256)) errors.push('required actual load absent');
  if (requirements.mutant) {
    const mutant = requirements.mutant;
    if (!activations.some(row => row.id === mutant.id && row.path === mutant.path && row.sha256 === mutant.sha256 && Number.isSafeInteger(row.hits) && row.hits > 0)) errors.push('mutated mechanism not activated');
    if (!loads.some(row => row.path === mutant.path && row.sha256 === mutant.sha256)) errors.push('mutated bytes not loaded');
    if (!mutant.requiredFailed.length || !mutant.requiredFailed.every(id => failed.includes(id))) errors.push('designated mutant predicate not rejected');
  }
  return { coherent: errors.length === 0, accepted: errors.length === 0 && failed.length === 0,
    mutantKilled: errors.length === 0 && failed.length > 0 && Boolean(requirements.mutant), failed, errors, observations, loads, activations };
}
