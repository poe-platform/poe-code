import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { authenticate, authenticatedCore, base, expected, identity, inventory, own, repository, write } from './common.mjs';
import { adapted, drivers } from './adapt.mjs';
import { verifyExecution } from './verify.mjs';

assert.equal(process.argv.length, 3, 'execute.mjs RECIPE_COMMIT');
const recipeCommit = process.argv[2]; assert.match(recipeCommit, /^[a-f0-9]{40}$/u);
const output = join(own, 'execution'), work = join(own, 'node_modules', 'partial-work');
assert.ok(!existsSync(output) && !existsSync(work) && !existsSync(join(own, 'RESULT.json')), 'one write-once generation only');
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const env = { PATH: `${dirname(node)}:/usr/bin:/bin`, HOME: join(work, 'home'), TMPDIR: join(work, 'tmp'), TMP: join(work, 'tmp'), TEMP: join(work, 'tmp'), XDG_CACHE_HOME: join(work, 'cache'), LC_ALL: 'C', LANG: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', npm_config_cache: join(work, 'cache') };
for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, env);
const core = await authenticatedCore();
const manifest = JSON.parse(readFileSync(join(own, 'RECIPE-MANIFEST.json')));
for (const [name, entry] of Object.entries(manifest.files)) assert.deepEqual(identity(join(own, name)), entry, name);
for (const name of [...Object.keys(manifest.files), 'RECIPE-MANIFEST.json']) {
  const entry = core.entries(repository, recipeCommit, [relative(repository, join(own, name))]);
  assert.equal(entry.length, 1); assert.equal(entry[0].blob, identity(join(own, name)).blob); assert.equal(entry[0].mode, identity(join(own, name)).mode);
}
mkdirSync(output); mkdirSync(join(output, 'trace'));
mkdirSync(join(work, 'drivers'), { recursive: true });
for (const directory of ['home', 'tmp', 'cache']) mkdirSync(join(work, directory));
const results = [];
const phases = [
  { name: 'extras', driver: 'controls-extra.mjs', args: [join(output, 'extras')] },
  { name: 'admission', driver: 'run.mjs', args: [join(base, 'binding-04/BINDINGS.json'), expected.binding, join(output, 'admission'), '--admission-build'] },
  { name: 'reconstruction', driver: 'reconstruct-only.mjs', args: [join(base, 'binding-04/BINDINGS.json'), expected.binding, join(output, 'reconstruction')] },
];
function groupMembers(group) {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat='], { env, encoding: 'utf8', maxBuffer: 4 * 1024 ** 2, timeout: 10000 });
  assert.ifError(result.error); assert.equal(result.status, 0);
  return result.stdout.split('\n').filter(line => Number(line.trim().split(/\s+/u)[2]) === group);
}
const sleep = milliseconds => new Promise(resolveResult => setTimeout(resolveResult, milliseconds));
async function phaseRun(phase) {
  const record = { name: phase.name, started: new Date().toISOString(), executable: node, executableIdentity: identity(node), args: [join(work, 'drivers', phase.driver), ...phase.args], env: { ...env, NODE_OPTIONS: `--require=${join(own, 'trace.cjs')}`, HTML_PARTIAL_TRACE: join(output, 'trace'), HTML_PARTIAL_COMMAND: phase.name }, phaseTimeoutMs: 900000, terminationGraceMs: 5000, stdoutCeiling: core.limits.commandBytes, stderrCeiling: core.limits.stderrBytes, signalsSent: [] };
  write(join(output, `${phase.name}.PRE.json`), record);
  const child = spawn(node, record.args, { cwd: repository, env: record.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  record.pid = child.pid;
  let escalation;
  function signalGroup(signal, reason) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); record.signalsSent.push({ signal, reason, at: new Date().toISOString() }); }
    catch (error) { if (error.code !== 'ESRCH') record.signalError = error.message; }
  }
  function stop(reason) {
    if (record.stopReason) return;
    record.stopReason = reason; signalGroup('SIGTERM', reason);
    escalation = setTimeout(() => signalGroup('SIGKILL', 'failure cleanup grace exceeded'), 5000);
  }
  const capture = (stream, ceiling, label) => {
    const chunks = []; let bytes = 0;
    stream.on('data', chunk => { bytes += chunk.length; if (bytes <= ceiling) chunks.push(Buffer.from(chunk)); else stop(`${label} ceiling`); });
    stream.on('error', error => { record[`${label}Error`] = error.message; stop(`${label} stream failure`); });
    return () => ({ bytes, retained: Buffer.concat(chunks) });
  };
  const stdout = capture(child.stdout, core.limits.commandBytes, 'stdout'), stderr = capture(child.stderr, core.limits.stderrBytes, 'stderr');
  const timer = setTimeout(() => { record.timedOut = true; stop('900s phase failure watchdog'); }, 900000);
  Object.assign(record, await new Promise(resolveResult => {
    child.once('error', error => { record.spawnError = error.message; });
    child.once('close', (status, signal) => resolveResult({ status, signal }));
  }));
  clearTimeout(timer); clearTimeout(escalation);
  record.closeObserved = true;
  record.membersAfterClose = child.pid ? groupMembers(child.pid) : [];
  if (record.membersAfterClose.length) {
    signalGroup('SIGTERM', 'unexpected remaining group after close'); await sleep(5000);
    if (groupMembers(child.pid).length) { signalGroup('SIGKILL', 'remaining group failure cleanup'); await sleep(1000); }
  }
  record.remainingGroupMembers = child.pid ? groupMembers(child.pid) : [];
  for (const [label, captured] of [['stdout', stdout()], ['stderr', stderr()]]) {
    const filename = join(output, `${phase.name}.${label}.data`); writeFileSync(filename, captured.retained, { flag: 'wx' });
    record[label] = { seenBytes: captured.bytes, retained: identity(filename) };
  }
  record.finished = new Date().toISOString();
  record.success = record.status === 0 && record.signal === null && !record.spawnError && !record.stopReason && !record.signalError && !record.stdoutError && !record.stderrError && record.signalsSent.length === 0 && record.remainingGroupMembers.length === 0;
  write(join(output, `${phase.name}.RAW.json`), record);
  results.push(record);
  console.log(JSON.stringify({ phase: phase.name, status: record.status, naturalClose: record.signalsSent.length === 0, remaining: record.remainingGroupMembers.length }));
  assert.ok(record.success, `fail-closed phase ${phase.name}`);
}
const report = { schema: 'html-partial-execution/1', started: new Date().toISOString(), recipeCommit, recipeManifestSha256: identity(join(own, 'RECIPE-MANIFEST.json')).sha256, phases: phases.map(phase => phase.name), actualHtml34: 0, oldResource35: 0, resourceV32: 0, du29: 0, partialOnly: true };
write(join(output, 'SUPERVISOR-PRE.json'), { ...report, env, supervisor: identity(join(own, 'execute.mjs')) });
try {
  const pre = await authenticate();
  write(join(output, 'AUTH-PRE.json'), pre);
  assert.deepEqual(pre, JSON.parse(readFileSync(join(own, 'PREPARE-AUTH.json'))));
  const mappings = JSON.parse(readFileSync(join(own, 'ADAPTERS.json')));
  for (const name of drivers) {
    const { code, ...mapping } = adapted(name); assert.deepEqual(mapping, mappings.find(entry => entry.name === name));
    const filename = join(work, 'drivers', name); writeFileSync(filename, code, { flag: 'wx' }); assert.equal(identity(filename).sha256, mapping.newSha256);
  }
  for (const phase of phases) await phaseRun(phase);
  report.verified = verifyExecution();
  report.status = 'partial-four-plus-full-build-and-scoped-reconstruction-pass';
} catch (error) {
  report.status = 'HOLD-partial-execution-failed-no-retry'; report.error = { message: error.message, stack: error.stack, code: error.code };
  write(join(output, 'FAILURE.json'), report.error); process.exitCode = 1;
} finally {
  report.results = results; report.unexecutedPhases = phases.slice(results.length).map(phase => phase.name);
  try {
    const post = await authenticate(); write(join(output, 'AUTH-POST.json'), post);
    assert.deepEqual(post, JSON.parse(readFileSync(join(own, 'PREPARE-AUTH.json'))));
    for (const [name, entry] of Object.entries(manifest.files)) assert.deepEqual(identity(join(own, name)), entry);
    report.protectedPost = { equal: true, authorFiles: Object.keys(post.sealed).length, originalFixtures: Object.keys(post.fixtures).length, oldHoldFiles: Object.keys(post.hold).length, metadataLinks: post.links.length, toolTrees: 'all bound tools unchanged', appendProof: 'Exact full file inventories of sealed admission-v2 and prior HOLD; frozen18 exact paths only. No global index/live source census.' };
  } catch (error) { report.postError = { message: error.message, stack: error.stack }; report.status = 'HOLD-postcheck-failed'; process.exitCode = 1; }
  report.allGroupsSettled = results.every(result => result.closeObserved && result.remainingGroupMembers.length === 0);
  if (report.allGroupsSettled) {
    write(join(output, 'WORKTREE-FINAL-INVENTORY.json'), inventory(work));
    rmSync(work, { recursive: true });
    report.worktreeRemoved = !existsSync(work);
  } else { report.worktreeRemoved = false; process.exitCode = 1; }
  report.finished = new Date().toISOString();
  write(join(output, 'SUPERVISOR.json'), report);
  const archive = join(own, 'captures.tgz');
  const packed = spawnSync('/usr/bin/tar', ['-czf', archive, '-C', output, '.'], { env, encoding: 'utf8', timeout: 180000, maxBuffer: core.limits.commandBytes });
  const compact = { status: packed.status, signal: packed.signal, error: packed.error?.message, stdout: packed.stdout, stderr: packed.stderr, tool: identity('/usr/bin/bsdtar') };
  write(join(own, 'COMPACT-RAW.json'), compact);
  assert.ifError(packed.error); assert.equal(packed.status, 0); assert.equal(packed.signal, null);
  report.compact = identity(archive);
  report.rawFiles = inventory(output);
  rmSync(output, { recursive: true });
  report.executionDirectoryRemoved = !existsSync(output);
  write(join(own, 'RESULT.json'), report);
  console.log(JSON.stringify({ status: report.status, controls: report.verified?.passed ?? null, groupsSettled: report.allGroupsSettled, cleanup: report.worktreeRemoved, unexecuted: report.unexecutedPhases, capturesSha256: report.compact.sha256 }));
}
