import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const output = path.join(root, 'capture-01');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const sealBytes = fs.readFileSync(path.join(root, 'PRESEAL.json'));
const seal = JSON.parse(sealBytes);
const freezeCommit = process.argv[2];
requireThat(typeof freezeCommit === 'string' && /^[a-f0-9]{40}$/.test(freezeCommit), 'Explicit immutable freeze commit required');
requireThat(process.execPath === node && process.version === 'v22.22.2', 'Pinned Node required');
const gitBytes = relative => execFileSync('/usr/bin/git', ['show', `${freezeCommit}:${path.relative(repository, path.join(root, relative))}`], { cwd: repository, maxBuffer: 4 * 1024 * 1024 });
requireThat(hash(gitBytes('PRESEAL.json')) === hash(sealBytes), 'Committed seal differs');
const verify = () => {
  for (const entry of seal.sources) {
    const filename = path.join(root, entry.path);
    const info = fs.lstatSync(filename);
    const bytes = fs.readFileSync(filename);
    requireThat(info.isFile() && !info.isSymbolicLink() && info.size === entry.bytes && (info.mode & 0o7777) === entry.mode && hash(bytes) === entry.sha256 && hash(gitBytes(entry.path)) === entry.sha256, `Frozen source mismatch: ${entry.path}`);
  }
  requireThat(hash(fs.readFileSync(node)) === seal.node.sha256, 'Node binary changed');
};
verify();
const expectations = JSON.parse(fs.readFileSync(path.join(root, 'EXPECTATIONS.json')));
requireThat(expectations.cases.length === 15 && expectations.caseCount === 15, 'Frozen denominator mismatch');
fs.mkdirSync(output, { mode: 0o755 });
const foreignCwd = path.join(output, 'foreign-cwd');
fs.mkdirSync(foreignCwd);
const save = (name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
const absent = identifier => {
  try { process.kill(identifier, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
};
const supervise = config => new Promise(resolve => {
  const receipt = { id: config.scenario.id, pid: null, group: null, exit: null, close: null, failures: [], signals: [], stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0 };
  const configPath = path.join(output, `${config.scenario.id}.config.json`);
  save(`${config.scenario.id}.config.json`, config);
  const configHash = hash(fs.readFileSync(configPath));
  receipt.configSha256 = configHash;
  const child = spawn(node, ['--unhandled-rejections=strict', '--max-old-space-size=64', path.join(root, 'worker.mjs'), configPath, configHash], {
    cwd: config.scenario.cwd === 'foreign' ? foreignCwd : root,
    detached: true, env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: root, TMPDIR: output }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  receipt.pid = child.pid ?? null;
  receipt.group = child.pid ?? null;
  const signal = kind => {
    if (!child.pid) return;
    try { process.kill(-child.pid, kind); receipt.signals.push(kind); }
    catch (error) { if (error.code !== 'ESRCH') receipt.failures.push(error.message); }
  };
  const deadline = setTimeout(() => { receipt.failures.push('DEADLINE'); signal('SIGKILL'); }, 8000);
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
    receipt[`${stream}Bytes`] += bytes.length;
    if (receipt[`${stream}Bytes`] > 65536) { receipt.failures.push(`${stream}:OUTPUT_CAP`); signal('SIGKILL'); }
    else receipt[stream] += bytes.toString('utf8');
  });
  child.on('error', error => receipt.failures.push(error.message));
  child.on('exit', (code, signalValue) => { receipt.exit = { code, signal: signalValue }; });
  child.on('close', (code, signalValue) => {
    clearTimeout(deadline);
    receipt.close = { code, signal: signalValue };
    receipt.pidAbsent = !!child.pid && absent(child.pid);
    receipt.groupAbsent = !!child.pid && absent(-child.pid);
    receipt.reaped = receipt.pidAbsent && receipt.groupAbsent;
    resolve(receipt);
  });
});
const result = { kind: 'SYNTHETIC_ONLY_NOT_CANDIDATE_ACCEPTANCE', freezeCommit, presealSha256: hash(sealBytes), started: new Date().toISOString(), rows: [], productImports: 0, comparatorImports: 0, nativeOracleCalls: 0, archiveReads: 0, stagingCalls: 0, newGrant: false };
save('START.json', { ...result, supervisorPid: process.pid, sourceVerified: true });
try {
  for (const scenario of expectations.cases) {
    verify();
    const receipt = await supervise({ scenario, caseRoot: path.join(output, scenario.id), fixturesSha256: hash(fs.readFileSync(path.join(root, 'FIXTURES.json'))) });
    save(`${scenario.id}.receipt.json`, receipt);
    let observed;
    const errors = [];
    try { observed = JSON.parse(receipt.stdout); } catch { errors.push('INVALID_ENVELOPE'); }
    const expectedExit = scenario.expectedCode === null ? 0 : 23;
    if (!receipt.reaped || receipt.exit?.code !== expectedExit || receipt.close?.code !== expectedExit || receipt.exit?.signal !== null || receipt.close?.signal !== null || receipt.failures.length || receipt.signals.length || receipt.stderrBytes !== 0) errors.push('SUPERVISION_OR_EXIT');
    if (observed) {
      if (observed.observedCode !== scenario.expectedCode || observed.identity !== scenario.expectedIdentity || JSON.stringify(observed.evaluations) !== JSON.stringify(scenario.expectedEvaluations) || observed.loads.length !== scenario.expectedLoads) errors.push('OUTCOME');
      const expectedConsumer = pathToFileURL(path.join(output, scenario.id, scenario.action === 'move' ? 'relocated' : 'consumer', 'consumer.mjs')).href;
      const entry = pathToFileURL(path.join(root, 'worker.mjs')).href;
      if (observed.entryURL !== entry || observed.consumerURL !== expectedConsumer || observed.cwd !== (scenario.cwd === 'foreign' ? foreignCwd : root)) errors.push('ENTRY_OR_CWD');
      const bare = observed.resolutions.filter(row => row.specifier === scenario.library);
      if (scenario.expectedBarePath === null ? bare.length !== 0 : bare.length !== 1 || bare[0].url !== pathToFileURL(path.join(output, scenario.id, scenario.expectedBarePath)).href || bare[0].parentURL !== expectedConsumer) errors.push('BARE_RESOLUTION');
      if (observed.resolutions.length > 0 && (observed.resolutions[0].specifier !== expectedConsumer || observed.resolutions[0].parentURL !== entry)) errors.push('ENTRY_PARENT');
      if (scenario.action === 'entry-parent' && (observed.denied[0]?.parentURL !== entry || observed.denied[0]?.specifier !== expectedConsumer)) errors.push('NEGATIVE_ENTRY_PARENT');
      if (scenario.action === 'move' && (observed.oldOriginAbsent !== true || fs.existsSync(observed.oldOrigin))) errors.push('MOVED_ORIGIN');
      if (JSON.stringify(observed.beforeImport) !== JSON.stringify(observed.afterImport)) errors.push('IMPORT_MUTATION');
      if (scenario.expectedCode === null && !observed.wrapperBound) errors.push('UNBOUND_WRAPPER');
    }
    result.rows.push({ id: scenario.id, expectation: scenario.expectedCode === null ? 'positive' : 'expected-negative', observedCode: observed?.observedCode, passed: errors.length === 0, errors, pid: receipt.pid, reaped: receipt.reaped });
    if (errors.length) break;
  }
  verify();
  result.sourcesUnchanged = true;
} catch (error) {
  result.fatal = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  result.finished = new Date().toISOString();
  result.unrun = expectations.cases.slice(result.rows.length).map(row => row.id);
  result.passed = result.rows.filter(row => row.passed).length;
  result.failed = result.rows.filter(row => !row.passed).length;
  result.closed = result.rows.filter(row => row.reaped).length;
  result.status = !result.fatal && result.passed === 15 && result.closed === 15 ? 'EXPECTED_SYNTHETIC_OUTCOMES' : 'STOP_NO_REBASELINE';
  if (result.status !== 'EXPECTED_SYNTHETIC_OUTCOMES') process.exitCode = 1;
  save('RESULT.json', result);
  process.stdout.write(`${JSON.stringify({ status: result.status, passed: result.passed, failed: result.failed, closed: result.closed, unrun: result.unrun })}\n`);
}
