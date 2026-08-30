import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../..');
const revision = 'c800c899114c6c83b3d3eb67231176d124abaf49', product = '8670ebe8f0d39966c2de2638780437398e5f8490';
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false); mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync('/tmp/permission-independent-'));
const profiles = [
  { path: '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', version: 'v22.22.2', sha256: '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011' },
  { path: '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node', version: 'v24.11.1', sha256: '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0' },
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: temporary, TMPDIR: temporary, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (args, cwd = repository, extra = {}) => execFileSync('git', ['--no-replace-objects', ...args], { cwd, env: environment, timeout: 60000, maxBuffer: 64 * 1024 * 1024, ...extra });
const blob = (commit, path) => git(['show', `${commit}:${path}`]);
const report = { revision, product, runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), startedAt: new Date().toISOString(), staged: [], checks: [], children: [], admissions: [], importMap: [], fullRuntimeGroupsExecuted: false, privateAccess: false };
function stageGraph(commit, directory, path, seen = new Set()) {
  if (seen.has(path)) return; seen.add(path);
  const bytes = blob(commit, path); write(join(directory, path), bytes); report.staged.push({ commit, path, destination: join(directory, path), sha256: hash(bytes) });
  for (const match of bytes.toString().matchAll(/\bfrom\s*["'](\.[^"']+)["']/gu)) stageGraph(commit, directory, relative(directory, resolve(directory, dirname(path), match[1])), seen);
}
function inventory(directory) {
  const rows = {};
  function visit(current) { for (const name of readdirSync(current).sort()) { const path = join(current, name), key = relative(directory, path), stat = lstatSync(path); assert.equal(stat.isSymbolicLink(), false); if (stat.isDirectory()) { rows[key + '/'] = 'directory'; visit(path); } else rows[key] = hash(readFileSync(path)); } }
  visit(directory); return rows;
}
function check(name, action) { try { const detail = action(); report.checks.push({ name, pass: true, detail }); } catch (error) { report.checks.push({ name, pass: false, error: String(error), stack: error.stack }); } console.log(JSON.stringify(report.checks.at(-1))); }
function child(name, executable, args, cwd, timeout = 30000) {
  const result = spawnSync(executable, args, { cwd, env: environment, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  report.children.push({ name, executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.signal, null, name); assert.equal(result.error, undefined, name); return result;
}
try {
  for (const profile of profiles) assert.equal(hash(readFileSync(profile.path)), profile.sha256);
  const author = join(temporary, 'author'), frozen = join(temporary, 'frozen8670'), external = join(temporary, 'external'); mkdirSync(external);
  stageGraph(revision, author, 'tests/integration/runtime-permission-compatibility-20260827/controls.mjs');
  stageGraph(revision, author, 'scripts/verify-qualified-release.mjs');
  const objects = new Set([product]);
  for (const path of ['', 'src', 'src/index.ts']) objects.add(git(['rev-parse', path ? `${product}:${path}` : `${product}^{tree}`]).toString().trim());
  git(['init', '--quiet', '--template='], author); git(['index-pack', '--stdin'], author, { input: git(['pack-objects', '--stdout'], repository, { input: [...objects].join('\n') + '\n' }) });
  const authorResult = join(temporary, 'author-results.json').replace(/^\/private\/tmp\//u, '/tmp/');
  const authorRun = child('unchanged-author-26', profiles[0].path, [join(author, 'tests/integration/runtime-permission-compatibility-20260827/controls.mjs'), authorResult], author, 60000);
  report.author = JSON.parse(readFileSync(authorResult)); write(join(output, 'UNCHANGED-AUTHOR.json'), readFileSync(authorResult));
  assert.equal(authorRun.status, 0); assert.equal(report.author.controls.length, 26); assert.deepEqual(report.author.failures, []);
  const original = blob(revision, 'scripts/verify-current-consumers.mjs');
  const transformed = original.toString().replace(/\bfrom\s*(["'])(\.\.[^"']+)\1/gu, (whole, quote, specifier) => {
    const path = relative(external, resolve(external, 'scripts', specifier)); stageGraph(product, frozen, path);
    const replacement = pathToFileURL(join(frozen, path)).href; report.importMap.push({ specifier, replacement, commit: product, path }); return `from ${quote}${replacement}${quote}`;
  });
  const verifierPath = join(external, 'verify-current-consumers.mjs'); write(verifierPath, transformed);
  report.verifierOriginalSha256 = hash(original); report.verifierTransformedSha256 = hash(Buffer.from(transformed));
  const { probeConsumerPermission, consumerPermissionArgs, currentConsumers } = await import(pathToFileURL(verifierPath));
  const packagePath = '/tmp/safe-bash-package-8670-20260827-v1/virtual-bash-0.0.0.tgz';
  assert.equal(hash(readFileSync(packagePath)), '96d8256f3d763caa5442ba27b44e6b1f586d82d83d07d7d10369bed12426b5c1'); report.packageSha256 = hash(readFileSync(packagePath));
  const build = join(temporary, 'build'); mkdirSync(build); const tar = join(temporary, 'build.tar'); git(['archive', '-o', tar, product, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']); execFileSync('/usr/bin/tar', ['-xf', tar, '-C', build]);
  const tools = JSON.parse(blob('0579a239', 'tests/integration/full-gate-20260827/loader-null-source-review-node24-bodies/attempt-1/RESULT.json')).tools;
  for (const [path, pin] of Object.entries(tools)) { const bytes = readFileSync(join(repository, 'node_modules', path)); assert.equal(hash(bytes), pin.sha256); const target = join(build, 'node_modules', path); write(target, bytes); chmodSync(target, pin.mode); }
  assert.equal(child('fresh8670-build', profiles[1].path, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], build).status, 0);
  const built = inventory(join(build, 'dist')); report.freshDistSha256 = hash(Buffer.from(JSON.stringify(built))); write(join(output, 'FRESH-DIST.json'), JSON.stringify(built, null, 2) + '\n');
  const prepared = [];
  for (const profile of profiles) {
    const directory = join(temporary, profile.version), root = join(directory, 'source'); mkdirSync(join(root, 'src'), { recursive: true }); write(join(root, 'src/index.ts'), blob(product, 'src/index.ts'));
    const context = { directory, root, steps: [] }, admission = probeConsumerPermission(context, profile.path); report.admissions.push(admission);
    check(profile.version + ' actual binary stable permission qualification', () => { assert.equal(admission.flag, '--permission'); assert.equal(admission.sha256, profile.sha256); assert.equal(admission.identity.executable, profile.path); assert.equal(admission.identity.version, profile.version); assert.deepEqual(admission.probes.map(row => row.status), [0, 0, 1]); });
    const consumer = join(directory, 'consumer'), packages = join(consumer, 'node_modules'); mkdirSync(packages, { recursive: true }); execFileSync('/usr/bin/tar', ['-xf', packagePath, '-C', packages]); renameSync(join(packages, 'package'), join(packages, 'virtual-bash'));
    const installed = join(packages, 'virtual-bash'); assert.deepEqual(readFileSync(join(installed, 'package.json')), blob(product, 'package.json'));
    check(profile.version + ' moved package dist matches fresh8670 build', () => assert.deepEqual(inventory(join(installed, 'dist')), built));
    const packageBefore = inventory(installed), forbidden = join(root, 'src/index.ts'), destination = join(consumer, 'forbidden-write');
    const filename = join(consumer, 'positive.mjs');
    write(filename, `import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{Worker}from'node:worker_threads';import{Shell,agentCommands,MemoryFileSystem}from'virtual-bash';const fs=new MemoryFileSystem(),shell=new Shell({fs}).use(agentCommands());try{assert.equal(shell.commands.list().length,0);const result=await shell.exec("printf 'keep\\nskip\\n' | grep keep > /out; cat /out");assert.equal(result.exitCode,0);assert.equal(result.stdout,'keep\\n');assert.equal(new TextDecoder().decode(await fs.readFile('/out')),'keep\\n');assert.equal(shell.commands.list().length,70);assert.throws(()=>readFileSync(${JSON.stringify(forbidden)}),{code:'ERR_ACCESS_DENIED',permission:'FileSystemRead'});assert.throws(()=>writeFileSync(${JSON.stringify(destination)},'bad'),{code:'ERR_ACCESS_DENIED',permission:'FileSystemWrite'});const worker=new Worker("require('node:worker_threads').parentPort.postMessage('worker-ok')",{eval:true});const reply=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject)});assert.equal(reply,'worker-ok');await worker.terminate();console.log(JSON.stringify({execPath:process.execPath,version:process.version,registry:70,pipeline:true,vfs:true,worker:true,sourceDenied:true,writeDenied:true}));}finally{await shell.dispose();}\n`);
    const args = consumerPermissionArgs(admission, consumer, true);
    check(profile.version + ' exact worker and strict arguments', () => assert.deepEqual(args, ['--permission', '--allow-fs-read=' + consumer, '--allow-worker', '--unhandled-rejections=strict']));
    check(profile.version + ' actual public worker pipeline VFS and denials', () => { const result = child('positive-' + profile.version, profile.path, [...args, filename], consumer); assert.equal(result.status, 0, result.stderr); const witness = JSON.parse(result.stdout); assert.equal(witness.execPath, profile.path); assert.equal(witness.version, profile.version); assert.equal(existsSync(destination), false); return witness; });
    for (const [name, program, permission, resource] of [
      ['read', `require('node:fs').readFileSync(${JSON.stringify(forbidden)})`, 'FileSystemRead', forbidden],
      ['write', `require('node:fs').writeFileSync(${JSON.stringify(destination)},'bad')`, 'FileSystemWrite', destination],
      ['source-import', `import(${JSON.stringify(pathToFileURL(forbidden).href)})`, 'FileSystemRead', forbidden],
    ]) check(profile.version + ' uncaught exact ' + name + ' denial', () => { const result = child(name + '-' + profile.version, profile.path, [...args, '-e', program], consumer); assert.equal(result.status, 1); assert.match(result.stderr, /ERR_ACCESS_DENIED/u); assert.ok(result.stderr.includes(permission)); assert.ok(result.stderr.includes(resource)); assert.equal(existsSync(destination), false); });
    check(profile.version + ' removed permission mutant rejected by behavior', () => { const result = child('no-permission-' + profile.version, profile.path, ['--unhandled-rejections=strict', filename], consumer); assert.equal(result.status, 1); assert.match(result.stderr, /Missing expected exception/u); });
    check(profile.version + ' widened read mutant rejected by behavior', () => { const result = child('wide-read-' + profile.version, profile.path, ['--permission', '--allow-fs-read=' + directory, '--allow-worker', '--unhandled-rejections=strict', filename], consumer); assert.equal(result.status, 1); assert.match(result.stderr, /Missing expected exception/u); });
    check(profile.version + ' bad launch flag is status9 not denial', () => { const result = child('bad-flag-' + profile.version, profile.path, ['--definitely-not-a-node-flag', '-e', '0'], consumer); assert.equal(result.status, 9); assert.doesNotMatch(result.stderr, /ERR_ACCESS_DENIED/u); });
    check(profile.version + ' plain node:test execution preserves TAP consumers', () => { const file = join(consumer, 'tap.mjs'); write(file, "import{test}from'node:test';test('real-body',()=>{});\n"); const result = child('plain-test-' + profile.version, profile.path, [...args, file], consumer); assert.equal(result.status, 0); assert.match(result.stdout, /^# tests 1$/mu); assert.match(result.stdout, /^# pass 1$/mu); });
    check(profile.version + ' invalid admission and wildcard scopes refuse78', () => { assert.throws(() => consumerPermissionArgs({ ...admission, supported: false }, consumer), { exitCode: 78 }); assert.throws(() => consumerPermissionArgs(admission, consumer + '*'), { exitCode: 78 }); assert.throws(() => consumerPermissionArgs({ ...admission, flag: '--bogus' }, consumer), { exitCode: 78 }); });
    assert.deepEqual(inventory(installed), packageBefore); prepared.push({ profile, context, admission, consumer });
  }
  const mutable = join(temporary, 'mutable-node'); write(mutable, readFileSync(profiles[1].path)); chmodSync(mutable, 0o755);
  const mutableContext = { directory: join(temporary, 'mutable'), root: prepared[1].context.root, steps: [] }; mkdirSync(mutableContext.directory);
  const mutableAdmission = probeConsumerPermission(mutableContext, mutable);
  check('real copied binary admitted by actual behavior and content identity', () => { assert.equal(mutableAdmission.supported, true); assert.equal(mutableAdmission.sha256, profiles[1].sha256); assert.equal(mutableAdmission.identity.executable, mutable); });
  appendFileSync(mutable, '\n');
  check('actual post-admission binary mutation refuses78 before launch', () => assert.throws(() => consumerPermissionArgs(mutableAdmission, prepared[1].consumer, true), { exitCode: 78 }));
  rmSync(mutable);
  check('actual post-admission missing binary refuses78', () => assert.throws(() => consumerPermissionArgs(mutableAdmission, prepared[1].consumer), { exitCode: 78 }));
  const early = join(temporary, 'early'), root = join(early, 'source'); mkdirSync(join(root, 'src'), { recursive: true }); write(join(root, 'src/index.ts'), blob(product, 'src/index.ts'));
  const fake = join(early, 'no-mode'), marker = join(early, 'build-marker');
  write(fake, '#!' + profiles[1].path + '\nconsole.log(JSON.stringify({executable:' + JSON.stringify(fake) + ',version:"controlled-no-mode",flags:[]}));\n'); chmodSync(fake, 0o755);
  write(join(root, 'node_modules/typescript/bin/tsc'), "require('node:fs').writeFileSync(" + JSON.stringify(marker) + ",'BUILD-RAN');\n");
  const earlyProbe = join(early, 'probe.mjs'); write(earlyProbe, `import assert from'node:assert/strict';import{existsSync}from'node:fs';import{currentConsumers}from${JSON.stringify(pathToFileURL(verifierPath).href)};process.execPath=${JSON.stringify(fake)};const report={directory:${JSON.stringify(early)},root:${JSON.stringify(root)},steps:[]};try{currentConsumers(report);throw new Error('unexpected consumer execution')}catch(error){assert.equal(error.exitCode,78);assert.equal(report.steps.length,0);assert.equal(existsSync(${JSON.stringify(marker)}),false);console.log(JSON.stringify({exitCode:error.exitCode,steps:report.steps,buildRan:false}));process.exitCode=78;}\n`);
  check('actual currentConsumers refuses unsupported selected runtime before build', () => { const result = child('early-currentConsumers', profiles[1].path, [earlyProbe], early); assert.equal(result.status, 78, result.stderr); assert.equal(JSON.parse(result.stdout).buildRan, false); assert.equal(existsSync(marker), false); });
  check('source policy both release catch paths propagate78', () => { const source = original.toString(), caller = blob(revision, 'scripts/verify-qualified-release.mjs').toString(); assert.match(source, /finish\(report, error.exitCode === 78 \? 78 : 1, error\)/u); assert.match(caller, /if \(error.exitCode === 78\) throw error/u); assert.match(caller, /finish\(report, error.exitCode === 78 \? 78 : 1, error\)/u); });
  check('source policy only import mapping differs from reviewed verifier', () => { let restored = transformed; for (const entry of report.importMap) restored = restored.replace(entry.replacement, entry.specifier); assert.equal(restored, original.toString()); assert.equal(report.importMap.length, 5); });
  for (const row of report.staged) assert.equal(hash(readFileSync(row.destination)), row.sha256);
  for (const profile of profiles) assert.equal(hash(readFileSync(profile.path)), profile.sha256);
  assert.equal(hash(readFileSync(packagePath)), report.packageSha256);
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary); report.finishedAt = new Date().toISOString(); report.counts = { independent: report.checks.length, pass: report.checks.filter(row => row.pass).length, fail: report.checks.filter(row => !row.pass).length }; write(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n'); }
if (report.counts.fail) process.exitCode = 1;
console.log(JSON.stringify({ counts: report.counts, error: report.error, cleaned: report.cleaned }));
