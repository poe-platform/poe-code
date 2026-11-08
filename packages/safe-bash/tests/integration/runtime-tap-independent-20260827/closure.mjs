import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../..');
const revision = 'c800c899114c6c83b3d3eb67231176d124abaf49', baseline = '774644f9ea39b41f824db4c829e7a97e6e1386be', product = '8670ebe8f0d39966c2de2638780437398e5f8490';
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false); mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync('/tmp/tap-closure-independent-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: temporary, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (args, cwd = repository, extra = {}) => execFileSync('git', ['--no-replace-objects', ...args], { cwd, env: environment, maxBuffer: 32 * 1024 * 1024, timeout: 30000, ...extra });
const blob = (commit, path) => git(['show', `${commit}:${path}`]);
const report = { revision, baseline, product, runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), startedAt: new Date().toISOString(), source: [], importMap: [], checks: [], children: [], profiles: [], full16Groups: false, privateAccess: false };
function stage(commit, directory, path, seen = new Set()) { if (seen.has(path)) return; seen.add(path); const bytes = blob(commit, path); write(join(directory, path), bytes); report.source.push({ commit, path, destination: join(directory, path), sha256: hash(bytes) }); for (const match of bytes.toString().matchAll(/\bfrom\s*["'](\.[^"']+)["']/gu)) stage(commit, directory, relative(directory, resolve(directory, dirname(path), match[1])), seen); }
function check(name, action) { try { report.checks.push({ name, pass: true, detail: action() }); } catch (error) { report.checks.push({ name, pass: false, error: String(error), stack: error.stack }); } console.log(JSON.stringify(report.checks.at(-1))); }
function child(name, executable, args, cwd) { const result = spawnSync(executable, args, { cwd, env: environment, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 }); const row = { name, executable, args, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr }; report.children.push(row); assert.equal(result.error, undefined); assert.equal(result.signal, null); return row; }
try {
  const author = join(temporary, 'author'); stage(revision, author, 'tests/integration/runtime-permission-compatibility-20260827/tap-v1/controls.mjs');
  const objects = new Set([baseline]); for (const path of ['', 'scripts', 'scripts/verify-current-consumers.mjs']) objects.add(git(['rev-parse', path ? `${baseline}:${path}` : `${baseline}^{tree}`]).toString().trim());
  git(['init', '--quiet', '--template='], author); git(['index-pack', '--stdin'], author, { input: git(['pack-objects', '--stdout'], repository, { input: [...objects].join('\n') + '\n' }) });
  const authorOutput = join(temporary, 'author24.json').replace(/^\/private\/tmp\//u, '/tmp/');
  const authorRun = child('unchanged-author24', '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', [join(author, 'tests/integration/runtime-permission-compatibility-20260827/tap-v1/controls.mjs'), authorOutput], author);
  report.author24 = JSON.parse(readFileSync(authorOutput)); write(join(output, 'UNCHANGED-AUTHOR24.json'), readFileSync(authorOutput)); assert.equal(authorRun.status, 0); assert.equal(report.author24.controls.length, 24); assert.deepEqual(report.author24.failures, []);
  const source = blob(revision, 'scripts/verify-current-consumers.mjs').toString(), old = blob(baseline, 'scripts/verify-current-consumers.mjs').toString();
  report.verifierSha256 = hash(Buffer.from(source)); report.baselineVerifierSha256 = hash(Buffer.from(old));
  const external = join(temporary, 'external'), frozen = join(temporary, 'frozen8670');
  const transformed = source.replace(/\bfrom\s*(["'])(\.\.[^"']+)\1/gu, (whole, quote, specifier) => { const path = relative(external, resolve(external, 'scripts', specifier)); stage(product, frozen, path); const replacement = pathToFileURL(join(frozen, path)).href; report.importMap.push({ specifier, replacement, path, commit: product }); return `from ${quote}${replacement}${quote}`; });
  const verifier = join(external, 'verifier.mjs'); write(verifier, transformed); report.transformedSha256 = hash(Buffer.from(transformed));
  const { probeConsumerPermission, consumerPermissionArgs } = await import(pathToFileURL(verifier));
  const start = '      for (const runtime of group.runtime) {\n', end = '      }\n      assert.deepEqual(manifest(groupInstalled, "dist"), built);';
  function block(text) { assert.equal(text.split(start).length, 2); assert.equal(text.split(end).length, 2); return text.slice(text.indexOf(start) + start.length, text.indexOf(end)); }
  const body = block(source), oldBody = block(old), countBlock = text => text.slice(text.indexOf('        let counts;'));
  report.launchBlockSha256 = hash(Buffer.from(body)); report.countBlockSha256 = hash(Buffer.from(countBlock(body)));
  check('entire count/result block remains byte-identical', () => assert.equal(countBlock(body), countBlock(oldBody)));
  check('permission helpers and complete non-loop verifier remain unchanged', () => { assert.equal(source.slice(0, source.indexOf(start)), old.slice(0, old.indexOf(start))); assert.equal(source.slice(source.indexOf(end)), old.slice(old.indexOf(end))); });
  const wrapper = body => `import assert from 'node:assert/strict';import{join}from'node:path';import{consumerPermissionArgs}from${JSON.stringify(pathToFileURL(verifier).href)};export function dispatch(group,runtime,permission,consumer,config,report,step,environment,result){\n${body}\n}\n`;
  const currentPath = join(external, 'current-block.mjs'), oldPath = join(external, 'old-block.mjs'); write(currentPath, wrapper(body)); write(oldPath, wrapper(oldBody));
  const currentDispatch = (await import(pathToFileURL(currentPath))).dispatch, oldDispatch = (await import(pathToFileURL(oldPath))).dispatch;
  const profiles = [
    { version: 'v22.22.2', executable: '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', sha256: '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011' },
    { version: 'v24.11.1', executable: '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node', sha256: '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0' },
  ];
  for (const profile of profiles) {
    assert.equal(hash(readFileSync(profile.executable)), profile.sha256);
    const directory = join(temporary, profile.version), root = join(directory, 'source'), consumer = join(directory, 'consumer'); mkdirSync(consumer, { recursive: true }); write(join(root, 'src/index.ts'), blob(product, 'src/index.ts'));
    const permission = probeConsumerPermission({ directory, root }, profile.executable); report.profiles.push({ ...profile, permission });
    const forbidden = join(root, 'src/index.ts'), destination = join(consumer, 'forbidden-write');
    const fences = `assert.throws(()=>readFileSync(${JSON.stringify(forbidden)}),{code:'ERR_ACCESS_DENIED',permission:'FileSystemRead'});assert.throws(()=>writeFileSync(${JSON.stringify(destination)},'bad'),{code:'ERR_ACCESS_DENIED',permission:'FileSystemWrite'});`;
    const program = (count, modifier = '') => `import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';for(let index=0;index<${count};index++)test${modifier}('body-'+index,()=>{${fences}});\n`;
    function invoke(name, group, text, { suffix = '.mjs', dispatch = currentDispatch, spec = false } = {}) {
      const runtime = name + suffix, filename = join(consumer, runtime), result = { runtimeResults: [] }; write(filename, text);
      let execution;
      const step = (_report, label, executable, args, cwd, extra) => {
        assert.equal(executable, profile.executable); assert.deepEqual(extra.env, environment);
        assert.deepEqual(args.slice(0, 4), consumerPermissionArgs(permission, consumer, true)); assert.equal(args.at(-1), filename);
        if (args.includes('--test-reporter=tap')) assert.equal(args.indexOf('--test-reporter=tap'), 4);
        execution = child(profile.version + ':' + name, executable, spec ? args.map(arg => arg === '--test-reporter=tap' ? '--test-reporter=spec' : arg) : args, cwd);
        assert.equal(execution.status, 0, execution.stderr); return execution;
      };
      try { dispatch(group, runtime, permission, consumer, { compilerOptions: { outDir: consumer } }, {}, step, environment, result); return { result, execution }; }
      catch (error) { return { error, execution, result }; }
    }
    for (const [name, group, count, suffix] of [
      ['mandatory23', { name: 'mandatory', nodeTests: 23 }, 23, '.mjs'],
      ['loopback13', { name: 'webdav-loopback' }, 13, '.mjs'],
      ['constructor', { name: 's3-constructor' }, 4, '.mjs'],
      ['suffix', { name: 'independent-suffix' }, 3, '.test.mjs'],
    ]) check(profile.version + ':' + name + ' actual counted dispatch and fences', () => { const result = invoke(name, group, program(count), { suffix }); assert.equal(result.error, undefined, String(result.error)); assert.deepEqual(result.result.runtimeResults[0].counts, { tests: count, pass: count, fail: 0, cancelled: 0, skipped: 0, todo: 0 }); assert.equal(result.execution.args.includes('--test-reporter=tap'), true); assert.equal(existsSync(destination), false); });
    check(profile.version + ':plain runtime argument vector unchanged', () => { const result = invoke('plain', { name: 'plain' }, "console.log('plain-executed');\n"); assert.equal(result.error, undefined); assert.equal(result.result.runtimeResults[0].counts, undefined); assert.equal(result.execution.args.includes('--test-reporter=tap'), false); assert.equal(result.execution.stdout, 'plain-executed\n'); });
    for (const [name, group, text, options] of [
      ['missing-summary', { name: 'counted', nodeTests: 1 }, "console.log('no-summary');\n", {}],
      ['malformed-summary', { name: 'counted', nodeTests: 1 }, "console.log('# tests NaN\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0');\n", {}],
      ['zero-summary', { name: 'counted', nodeTests: 1 }, "console.log('# tests 0\\n# pass 0\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0');\n", {}],
      ['mandatory-short', { name: 'counted', nodeTests: 23 }, program(22), {}],
      ['loopback-short', { name: 'webdav-loopback' }, program(12), {}],
      ['skip', { name: 'counted', nodeTests: 1 }, program(1, '.skip'), {}],
      ['todo', { name: 'counted', nodeTests: 1 }, program(1, '.todo'), {}],
      ['wrong-reporter-mutant', { name: 'counted', nodeTests: 1 }, program(1), { spec: true }],
    ]) check(profile.version + ':' + name + ' rejected after successful process execution', () => { const result = invoke(name, group, text, options); assert.ok(result.error); assert.equal(result.execution.status, 0); assert.equal(result.result.runtimeResults.length, 0); return { error: String(result.error) }; });
    check(profile.version + ':same fixed source body through original launch block', () => { const result = invoke('old-launch', { name: 'counted', nodeTests: 1 }, program(1), { dispatch: oldDispatch }); assert.equal(result.execution.status, 0); if (profile.version === 'v24.11.1') { assert.ok(result.error); assert.equal(result.result.runtimeResults.length, 0); assert.match(result.execution.stdout, /ℹ tests 1/u); } else { assert.equal(result.error, undefined); assert.equal(result.result.runtimeResults[0].counts.tests, 1); } return { baselineAccepted: result.error === undefined }; });
    assert.equal(hash(readFileSync(profile.executable)), profile.sha256);
  }
  check('exact external helper map preserves original8670 inventory', () => { let restored = transformed; for (const row of report.importMap) { restored = restored.replace(row.replacement, row.specifier); assert.equal(row.commit, product); } assert.equal(restored, source); assert.equal(report.importMap.length, 5); });
  for (const row of report.source) assert.equal(hash(readFileSync(row.destination)), row.sha256);
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary); report.finishedAt = new Date().toISOString(); report.counts = { total: report.checks.length, pass: report.checks.filter(row => row.pass).length, fail: report.checks.filter(row => !row.pass).length }; write(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n'); }
if (report.counts.fail) process.exitCode = 1;
console.log(JSON.stringify({ counts: report.counts, error: report.error, cleaned: report.cleaned }));
