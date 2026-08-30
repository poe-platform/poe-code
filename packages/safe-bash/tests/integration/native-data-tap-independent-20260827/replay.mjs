import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { digest, fixture, git, inventory, json, node22, node24, npmCli, npmRoot, owned, policy, repository, selected, toolIdentity, tooling, version } from './common.mjs';

const preparationCommit = '591d2c20d08987bb0829ec91db7cc5cf333842ec';
const prepared = JSON.parse(readFileSync(join(owned, 'preexecution.json')));
const preparedTools = JSON.parse(gunzipSync(readFileSync(join(owned, 'preexecution-tooling.json.gz'))));
const directory = realpathSync(mkdtempSync('/tmp/native-data-tap-independent-'));
const report = { schema: 1, candidate: policy.candidate, preparationCommit, directory, startedAt: new Date().toISOString(), checks: [], rows: [], errors: [] };
const normalized = entries => entries.map(({ realpath, ...entry }) => entry);
const saveRaw = (name, data) => writeFileSync(join(directory, `${name}.json.gz`), gzipSync(Buffer.from(JSON.stringify(data) + '\n'), { level: 9 }), { flag: 'wx' });
console.log(JSON.stringify({ directory, preparationCommit, candidate: policy.candidate }));

function check(name, callback) {
  try { callback(); report.checks.push({ name, pass: true }); }
  catch (error) { report.checks.push({ name, pass: false, error: error.stack }); report.errors.push(name); }
}

function liveGroup(group) {
  return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,comm='], { timeout: 10000 }).toString().trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4] } : null;
  }).filter(entry => entry?.pgid === group);
}

async function run(executable, args, cwd, env, tracePath) {
  const startedAt = new Date().toISOString();
  const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let outputBytes = 0, killReason = null, error = null;
  const stdout = [], stderr = [], processes = new Map();
  function stop(reason) {
    if (killReason) return;
    killReason = reason;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
  child.on('error', failure => { error = failure.stack; });
  for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', bytes => {
    outputBytes += bytes.length;
    if (outputBytes > policy.bounds.outerOutputBytes) stop('output-limit');
    else chunks.push(Buffer.from(bytes));
  });
  const timeout = setTimeout(() => stop('timeout'), policy.bounds.perRunMilliseconds);
  const monitor = setInterval(() => {
    try {
      for (const entry of liveGroup(child.pid)) processes.set(entry.pid, entry);
      if (existsSync(tracePath) && statSync(tracePath).size > policy.bounds.traceBytes) stop('trace-limit');
    } catch (failure) { error = failure.stack; stop('process-monitor-error'); }
  }, 200);
  const outcome = await new Promise(resolve => child.on('close', (status, signal) => resolve({ status, signal })));
  clearTimeout(timeout); clearInterval(monitor);
  let remaining = liveGroup(child.pid);
  for (let attempt = 0; remaining.length && attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100)); remaining = liveGroup(child.pid);
  }
  if (remaining.length) stop('leaked-process-group');
  const trace = existsSync(tracePath) ? readFileSync(tracePath) : Buffer.alloc(0);
  const events = trace.toString().trim() ? trace.toString().trim().split('\n').map(line => JSON.parse(line)) : [];
  const observedSurvivors = events.filter(event => event.event === 'start').filter(event => {
    try { process.kill(event.pid, 0); return true; } catch { return false; }
  }).map(event => event.pid);
  return { executable, realpath: realpathSync(executable), args, cwd, env, startedAt, endedAt: new Date().toISOString(), ...outcome, error, killReason,
    stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64'), outputBytes,
    traceBase64: trace.toString('base64'), events, processGroup: child.pid, observedProcesses: [...processes.values()], remaining, observedSurvivors, finalGroup: liveGroup(child.pid) };
}

try {
  for (const path of ['policy.json', 'preexecution.json', 'preexecution-tooling.json.gz', 'common.mjs', 'prepare.mjs']) {
    assert.ok(readFileSync(join(owned, path)).equals(git('show', `${preparationCommit}:tests/integration/native-data-tap-independent-20260827/${path}`)), path);
  }
  assert.equal(digest(readFileSync(join(owned, 'policy.json'))), prepared.policySha256);
  assert.deepEqual(inventory(tooling), preparedTools.tooling);
  assert.deepEqual(inventory(npmRoot), preparedTools.npm);
  report.toolsBefore = prepared.tools.map(tool => toolIdentity(tool.path));
  assert.deepEqual(report.toolsBefore, prepared.tools);
  report.versionsBefore = [node22, node24].map(executable => ({ executable, version: version(executable), npmVersion: version(executable, [npmCli, '--version']) }));
  const frozenTools = join(directory, 'tooling/node_modules');
  mkdirSync(dirname(frozenTools));
  cpSync(tooling, frozenTools, { recursive: true, verbatimSymlinks: true });
  const frozenToolInventory = inventory(frozenTools);
  assert.deepEqual(normalized(frozenToolInventory), normalized(preparedTools.tooling));
  for (const entry of frozenToolInventory.filter(entry => entry.kind === 'link')) assert.ok(entry.realpath.startsWith(frozenTools + '/'));
  const observer = join(directory, 'observe.mjs');
  cpSync(join(owned, 'observe.mjs'), observer);
  const observerHash = digest(readFileSync(observer));
  report.harness = ['replay.mjs', 'observe.mjs', 'common.mjs'].map(path => ({ path, sha256: digest(readFileSync(join(owned, path))) }));
  const runtimeBase = join(directory, 'host'); mkdirSync(runtimeBase);
  const userConfig = join(runtimeBase, 'user.npmrc'), globalConfig = join(runtimeBase, 'global.npmrc');
  writeFileSync(userConfig, ''); writeFileSync(globalConfig, '');
  const variants = [
    { name: 'candidate-node22', executable: node22 },
    { name: 'candidate-node24', executable: node24 },
    { name: 'remove-current-tap-node24', executable: node24, from: '["test", "--", "--test-reporter=tap"]', to: '["test"]' },
    { name: 'historical-tap-after-glob-node24', executable: node24, from: 'original.before.testScript.replace("--test ", "--test --test-reporter=tap ")', to: 'original.before.testScript + " --test-reporter=tap"' },
    { name: 'historical-forced-spec-node24', executable: node24, from: 'original.before.testScript.replace("--test ", "--test --test-reporter=tap ")', to: 'original.before.testScript.replace("--test ", "--test --test-reporter=spec ")' }
  ];
  for (const variant of variants) {
    const root = join(directory, variant.name, 'input'), bin = join(directory, variant.name, 'bin');
    mkdirSync(root, { recursive: true }); mkdirSync(bin);
    for (const input of prepared.inputs) {
      const bytes = git('show', `${policy.candidate}:${input.path}`);
      assert.equal(digest(bytes), input.sha256);
      const target = join(root, input.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' });
    }
    const original = readFileSync(join(root, fixture), 'utf8');
    if (variant.from) {
      assert.equal(original.split(variant.from).length, 2);
      writeFileSync(join(root, fixture), original.replace(variant.from, variant.to));
    }
    symlinkSync(frozenTools, join(root, 'node_modules'), 'dir');
    symlinkSync(variant.executable, join(bin, 'node'));
    writeFileSync(join(bin, 'npm'), `#!/bin/sh\nexec ${JSON.stringify(variant.executable)} ${JSON.stringify(npmCli)} "$@"\n`, { mode: 0o755, flag: 'wx' });
    const tracePath = join(directory, `${variant.name}.trace.jsonl`);
    const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: runtimeBase, TMPDIR: runtimeBase, LC_ALL: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1',
      NODE_OPTIONS: `--import=${observer}`, INDEPENDENT_TRACE: tracePath, INDEPENDENT_INPUT: root,
      npm_config_cache: join(runtimeBase, 'npm-cache'), npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig, npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
    const args = ['--import', 'tsx', '--test', '--test-reporter=tap', ...(variant.from ? ['--test-name-pattern=actual npm script'] : []), fixture];
    const before = inventory(root), binBefore = inventory(bin);
    const result = await run(variant.executable, args, root, env, tracePath);
    const after = inventory(root), binAfter = inventory(bin);
    const stdout = Buffer.from(result.stdoutBase64, 'base64').toString(), stderr = Buffer.from(result.stderrBase64, 'base64').toString();
    const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
    const names = [...stdout.matchAll(/^# Subtest: (.*)$/gmu)].map(match => match[1]);
    const npmCalls = result.events.filter(event => event.event === 'spawn-after' && event.command === 'npm').map(event => ({ ...event, stdout: Buffer.from(event.stdoutBase64 ?? '', 'base64').toString(), stderr: Buffer.from(event.stderrBase64 ?? '', 'base64').toString() }));
    const fixtureSnapshots = result.events.filter(event => event.event === 'spawn-before' && event.command === 'npm');
    const row = { ...variant, counts, names, status: result.status, killReason: result.killReason, npmCalls: npmCalls.map(({ stdout, stderr, stdoutBase64, stderrBase64, ...event }) => ({ ...event, stdoutSha256: digest(Buffer.from(stdout)), stderrSha256: digest(Buffer.from(stderr)), tapCounts: Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])])) })) };
    saveRaw(variant.name, { variant, candidate: policy.candidate, preparationCommit, inputHashes: prepared.inputs, actualFixtureHash: digest(readFileSync(join(root, fixture))), before, after, binBefore, binAfter, counts, names, result });
    report.rows.push(row);
    check(`${variant.name}: natural closure and no surviving owned children`, () => {
      assert.equal(result.error, null); assert.equal(result.signal, null); assert.equal(result.killReason, null);
      assert.deepEqual(result.remaining, []); assert.deepEqual(result.finalGroup, []); assert.deepEqual(result.observedSurvivors, []);
      for (const event of result.events.filter(event => event.event === 'spawn-after')) { assert.equal(event.error, null); assert.equal(event.signal, null); }
    });
    check(`${variant.name}: byte and entry sourceguards`, () => { assert.deepEqual(after, before); assert.deepEqual(binAfter, binBefore); assert.equal(digest(readFileSync(observer)), observerHash); });
    check(`${variant.name}: authenticated actual child runtime and npm CLI`, () => {
      const starts = result.events.filter(event => event.event === 'start');
      assert.ok(starts.some(event => event.argv.includes(npmCli)));
      const forwarded = result.events.filter(event => event.event === 'spawn-before' && event.command === variant.executable && event.args.includes('--test'));
      assert.equal(forwarded.length, 1);
      assert.equal(forwarded[0].args.includes('--test-reporter=tap'), variant.name !== 'remove-current-tap-node24');
      for (const event of starts) { assert.equal(realpathSync(event.executable), realpathSync(variant.executable)); assert.equal(event.version, prepared.runtimeVersions.find(tool => tool.path === variant.executable).version); assert.equal(event.nodeOptions, env.NODE_OPTIONS); }
    });
    check(`${variant.name}: actual nested fixtures remain original bytes`, () => {
      assert.ok(fixtureSnapshots.length >= 1);
      for (const snapshot of fixtureSnapshots) {
        const tests = snapshot.fixtureInputs.filter(entry => entry.path.endsWith('.test.ts'));
        assert.equal(tests.length, 7);
        const marker = tests.filter(entry => Buffer.from(entry.base64, 'base64').toString() === "throw new Error('NATIVE_DATA_MUST_NOT_EXECUTE');\n");
        assert.equal(marker.length, 2);
        assert.equal(snapshot.fixtureInputs.find(entry => entry.path === 'tsconfig.json').sha256, prepared.inputs.find(entry => entry.path === 'tsconfig.json').sha256);
      }
      if (fixtureSnapshots.length === 2) assert.deepEqual(fixtureSnapshots[0].fixtureInputs.filter(entry => entry.path !== 'package.json'), fixtureSnapshots[1].fixtureInputs.filter(entry => entry.path !== 'package.json'));
    });
    if (!variant.from) {
      check(`${variant.name}: exact canonical eight and actual nested TAP captures`, () => {
        assert.equal(result.status, 0); assert.deepEqual(names, prepared.fixture.names);
        assert.deepEqual(counts, { tests: 8, pass: 8, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
        assert.equal(npmCalls.length, 2);
        assert.deepEqual(npmCalls[0].args, ['test', '--', '--test-reporter=tap']);
        assert.equal(npmCalls[0].status, 0); assert.match(npmCalls[0].stdout, /^# tests 5$/mu); assert.match(npmCalls[0].stdout, /^# pass 5$/mu);
        assert.doesNotMatch(npmCalls[0].stdout + npmCalls[0].stderr, /NATIVE_DATA_MUST_NOT_EXECUTE/u);
        assert.equal(npmCalls[1].status, 1); assert.match(npmCalls[1].stdout, /^# tests 7$/mu); assert.match(npmCalls[1].stdout, /^# fail 2$/mu);
        assert.match(npmCalls[1].stdout + npmCalls[1].stderr, /NATIVE_DATA_MUST_NOT_EXECUTE/u);
        const historicalScript = JSON.parse(Buffer.from(fixtureSnapshots[1].fixtureInputs.find(entry => entry.path === 'package.json').base64, 'base64')).scripts.test;
        assert.equal(historicalScript, prepared.scripts.historicalTest.replace('--test ', '--test --test-reporter=tap '));
        assert.equal(digest(Buffer.from(original)), prepared.fixture.sha256);
      });
    } else if (variant.name !== 'historical-tap-after-glob-node24') {
      check(`${variant.name}: real reporter fault detected by unchanged assertion`, () => {
        assert.equal(result.status, 1); assert.deepEqual(counts, { tests: 1, pass: 0, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
        assert.match(stdout, /input did not match the regular expression/u);
        assert.doesNotMatch(stdout + stderr, /double-loading config|ERR_MODULE_NOT_FOUND|SyntaxError/u);
        const nested = npmCalls.at(-1), expected = variant.name === 'remove-current-tap-node24' ? 5 : 7;
        assert.equal(nested.status, expected === 5 ? 0 : 1);
        assert.match(nested.stdout, new RegExp(`ℹ tests ${expected}`, 'u'));
        assert.doesNotMatch(nested.stdout, new RegExp(`^# tests ${expected}$`, 'mu'));
        assert.ok(stdout.includes(`# tests ${expected}`));
      });
    } else {
      row.observedOrderOutcome = result.status === 0 ? 'accepted; not a fault detector' : 'rejected; inspect actual nested result, not presumed order failure';
      check(`${variant.name}: genuine after-glob observation retained`, () => {
        assert.equal(npmCalls.length, 2);
        const script = JSON.parse(Buffer.from(fixtureSnapshots[1].fixtureInputs.find(entry => entry.path === 'package.json').base64, 'base64')).scripts.test;
        assert.equal(script, prepared.scripts.historicalTest + ' --test-reporter=tap');
        if (result.status === 0) { assert.equal(counts.pass, 1); assert.match(npmCalls[1].stdout, /^# tests 7$/mu); assert.match(npmCalls[1].stdout, /^# fail 2$/mu); }
        else { assert.equal(result.status, 1); assert.equal(counts.fail, 1); }
      });
    }
    console.log(JSON.stringify({ name: variant.name, status: result.status, counts, npm: row.npmCalls.map(event => ({ args: event.args, status: event.status, counts: event.tapCounts })), killReason: result.killReason, errors: report.errors }));
  }
  const guardRoot = join(directory, 'guard-control'); mkdirSync(guardRoot);
  const configBytes = git('show', `${policy.candidate}:tsconfig.json`);
  writeFileSync(join(guardRoot, 'tsconfig.json'), configBytes);
  const guardBefore = inventory(guardRoot);
  writeFileSync(join(guardRoot, 'added.json'), '{}\n');
  const added = inventory(guardRoot);
  const { unlinkSync } = await import('node:fs'); unlinkSync(join(guardRoot, 'added.json'));
  writeFileSync(join(guardRoot, 'tsconfig.json'), Buffer.concat([configBytes, Buffer.from(' ')]));
  const mutated = inventory(guardRoot);
  writeFileSync(join(guardRoot, 'tsconfig.json'), configBytes);
  const restored = inventory(guardRoot);
  check('guard detects new entries and changed config bytes', () => { assert.notDeepEqual(added, guardBefore); assert.notDeepEqual(mutated, guardBefore); assert.deepEqual(restored, guardBefore); });
  saveRaw('guard-controls', { guardBefore, added, mutated, restored });
  const toolingAfter = inventory(tooling), npmAfter = inventory(npmRoot), frozenToolsAfter = inventory(frozenTools);
  check('complete original and copied tool membership/bytes unchanged including additions', () => { assert.deepEqual(toolingAfter, preparedTools.tooling); assert.deepEqual(npmAfter, preparedTools.npm); assert.deepEqual(frozenToolsAfter, frozenToolInventory); });
  report.toolsAfter = prepared.tools.map(tool => toolIdentity(tool.path));
  report.versionsAfter = [node22, node24].map(executable => ({ executable, version: version(executable), npmVersion: version(executable, [npmCli, '--version']) }));
  check('actual executable versions, realpaths and hashes unchanged', () => { assert.deepEqual(report.toolsAfter, report.toolsBefore); assert.deepEqual(report.versionsAfter, report.versionsBefore); });
  saveRaw('tool-guards', { originalBefore: preparedTools, originalAfter: { tooling: toolingAfter, npm: npmAfter }, copiedBefore: frozenToolInventory, copiedAfter: frozenToolsAfter });
} catch (error) { report.errors.push({ fatal: error.stack }); }
finally {
  report.finishedAt = new Date().toISOString(); report.status = report.errors.length ? 'fail' : 'pass';
  json(join(directory, 'REPORT.json'), report);
  console.log(JSON.stringify({ directory, status: report.status, checks: report.checks.length, errors: report.errors }));
  if (report.errors.length) process.exitCode = 1;
}
