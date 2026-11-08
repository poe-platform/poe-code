import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, readlinkSync, copyFileSync, renameSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const evidence = join(own, 'evidence-v1');
const inputBytes = readFileSync(join(evidence, 'INPUTS.json'));
const inputs = JSON.parse(inputBytes);
const sealBytes = readFileSync(join(own, 'RUN-SEAL.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(sealBytes), process.argv[2]);
const seal = JSON.parse(sealBytes);
assert.equal(hash(inputBytes), seal.inputsSHA256);
const guard = () => {
  for (const binding of inputs.tools) {
    const stat = lstatSync(binding.path);
    if (binding.metadataOnly) { assert(stat.isSymbolicLink()); assert.equal(readlinkSync(binding.path), binding.alias); }
    else {
      assert(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.mode & 0o777, binding.mode); assert.equal(hash(readFileSync(binding.path)), binding.sha256, binding.path);
      const dependencyPrefix = resolve(own, '../../../node_modules') + '/';
      if (binding.path.startsWith(dependencyPrefix)) {
        const copied = join(own, 'work/node_modules', binding.path.slice(dependencyPrefix.length));
        assert(lstatSync(copied).isFile() && !lstatSync(copied).isSymbolicLink());
        assert.equal(lstatSync(copied).mode & 0o777, binding.mode); assert.equal(hash(readFileSync(copied)), binding.sha256, copied);
      }
    }
  }
  for (const [filename, expected] of Object.entries(seal.harness)) assert.equal(hash(readFileSync(join(own, filename))), expected, filename);
  for (const binding of [...inputs.sourceInputs, ...inputs.testInputs]) {
    const filename = join(inputs.source, binding.path);
    assert(lstatSync(filename).isFile() && !lstatSync(filename).isSymbolicLink());
    assert.equal(lstatSync(filename).mode & 0o777, (binding.mode ?? 0o644) & 0o777);
    assert.equal(hash(readFileSync(filename)), binding.sha256, binding.path);
  }
};
guard();
const work = join(own, 'work');
const source = inputs.source;
const node = inputs.node;
const npmCLI = join(inputs.npm, 'bin/npm-cli.js');
const tsc = join(work, 'node_modules/typescript/bin/tsc');
const home = join(work, 'home'); const temporary = join(work, 'tmp');
mkdirSync(home); mkdirSync(temporary);
const environment = { PATH: `${dirname(node)}:/usr/bin:/bin`, HOME: home, TMPDIR: temporary, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', npm_config_cache: join(work, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_offline: 'true', ESBUILD_BINARY_PATH: join(work, 'node_modules/@esbuild/darwin-arm64/bin/esbuild') };
const commands = [];
const results = { schema: 'let-author-run-v1', candidate: inputs.candidate, started: new Date().toISOString(), source: null, moved: null, regressions: null, types: [], mutants: [], controls: [], failures: [], nativeExecutions: 0 };
writeFileSync(join(evidence, 'RUN-START.json'), JSON.stringify({ ...results, runSealSHA256: process.argv[2], preGuards: 'passed' }, null, 2) + '\n', { flag: 'wx' });
const run = (id, executable, args, cwd, extra = {}, milliseconds = 120000) => new Promise(resolveRun => {
  const start = performance.now(); let failure; let bytes = 0; let escalation;
  const stdout = []; const stderr = [];
  const child = spawn(executable, args, { cwd, env: { ...environment, ...extra }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = signal => { if (child.pid) { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') failure ??= String(error); } } };
  const stop = reason => { if (failure) return; failure = reason; kill('SIGTERM'); escalation = setTimeout(() => kill('SIGKILL'), 500); };
  const collect = target => chunk => { bytes += chunk.length; if (bytes <= 8 * 1024 * 1024) target.push(Buffer.from(chunk)); else stop('OUTPUT_LIMIT'); };
  child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
  child.on('error', error => { failure ??= String(error); });
  const timeout = setTimeout(() => stop('TIMEOUT'), milliseconds);
  child.on('close', (code, signal) => {
    clearTimeout(timeout); clearTimeout(escalation);
    let groupAbsent = true;
    if (child.pid) { try { process.kill(-child.pid, 0); groupAbsent = false; } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    if (!groupAbsent) kill('SIGKILL');
    const output = Buffer.concat(stdout); const diagnostic = Buffer.concat(stderr);
    writeFileSync(join(evidence, `${id}.stdout.data`), output, { flag: 'wx' });
    writeFileSync(join(evidence, `${id}.stderr.data`), diagnostic, { flag: 'wx' });
    const receipt = { id, executable, args, cwd, pid: child.pid, code, signal, failure: failure ?? null, groupAbsent, closeObserved: true, elapsedMilliseconds: performance.now() - start, stdoutBytes: output.length, stderrBytes: diagnostic.length, stdoutSHA256: hash(output), stderrSHA256: hash(diagnostic) };
    commands.push(receipt); appendFileSync(join(evidence, 'COMMANDS.jsonl'), JSON.stringify(receipt) + '\n');
    console.log(JSON.stringify(receipt));
    resolveRun({ ...receipt, stdout: output.toString(), stderr: diagnostic.toString() });
  });
});
const requireNatural = receipt => { assert.equal(receipt.failure, null); assert.equal(receipt.signal, null); assert.equal(receipt.groupAbsent, true); };
const requireSuccess = receipt => { requireNatural(receipt); assert.equal(receipt.code, 0, `${receipt.id}: ${receipt.stdout.slice(-3000)} ${receipt.stderr.slice(-1000)}`); };
const inventory = root => {
  const files = {};
  const walk = relative => {
    for (const name of readdirSync(join(root, relative)).sort()) {
      assert.notEqual(name, 'AGENTS.md');
      const filename = join(relative, name); const stat = lstatSync(join(root, filename));
      assert(!stat.isSymbolicLink());
      if (stat.isDirectory()) walk(filename); else { assert(stat.isFile()); files[filename] = hash(readFileSync(join(root, filename))); }
    }
  };
  walk('dist');
  for (const name of ['package.json', 'README.md']) files[name] = hash(readFileSync(join(root, name)));
  const expected = ['package.json', 'README.md', ...inputs.sourceInputs.filter(row => row.path.endsWith('.ts')).flatMap(row => {
    const stem = row.path.replace(/^src\//u, 'dist/').slice(0, -3);
    return ['.js', '.js.map', '.d.ts', '.d.ts.map'].map(suffix => stem + suffix);
  })];
  assert.deepEqual(Object.keys(files).sort(), expected.sort(), 'COMPLETE_DIST_INVENTORY');
  return files;
};
const harness = Object.fromEntries(['checks.mjs', 'guard-control.mjs'].map(name => [join(own, name), hash(readFileSync(join(own, name)))]));
const behavior = async (id, root, layout, ids) => {
  const files = inventory(root);
  const body = layout === 'moved' ? join(dirname(dirname(root)), 'checks.mjs') : join(own, 'checks.mjs');
  if (layout === 'moved') copyFileSync(join(own, 'checks.mjs'), body);
  const binding = { layout, root, candidate: inputs.candidate, files, harness: { ...harness, [body]: hash(readFileSync(body)) } };
  const filename = join(evidence, `${id}.binding.json`); const bytes = JSON.stringify(binding, null, 2) + '\n'; writeFileSync(filename, bytes, { flag: 'wx' });
  const receipt = await run(id, node, ['--unhandled-rejections=strict', '--import', join(own, 'load-hook.mjs'), body], dirname(body), { LET_BINDING: filename, LET_BINDING_SHA256: hash(bytes), LET_LOAD_RECEIPT: join(evidence, `${id}.loads.jsonl`), LET_CASES: join(evidence, 'frozen-cases.json'), ...(ids ? { LET_IDS: ids.join(',') } : {}) });
  requireNatural(receipt);
  const rows = receipt.stdout.trim().split('\n').map(line => JSON.parse(line));
  const summary = rows.findLast(row => row.summary)?.summary;
  assert(summary, `${id}: no complete summary`);
  assert.equal(summary.createdShells, summary.disposedShells);
  const loads = readFileSync(join(evidence, `${id}.loads.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
  for (const name of ['runtime', 'arithmetic', 'cancellation']) assert(loads.some(row => row.url === pathToFileURL(join(root, `dist/shell/${name}.js`)).href));
  return { receipt: { code: receipt.code }, summary, binding: filename, observations: rows.filter(row => row.observation).map(row => row.observation), loadCount: loads.length };
};
try {
  requireSuccess(await run('build-source', node, [tsc, '-p', 'tsconfig.build.json'], source));
  results.source = await behavior('source', source, 'source');
  if (results.source.summary.failed.length) results.failures.push({ phase: 'source', cases: results.source.summary.failed });
  const regression = await run('regressions', node, ['--unhandled-rejections=strict', '--import', join(work, 'node_modules/tsx/dist/loader.mjs'), '--test', '--test-concurrency=1', ...inputs.regressions], source, {}, 180000);
  requireNatural(regression); results.regressions = { code: regression.code, tail: regression.stdout.slice(-2000) }; if (regression.code) results.failures.push({ phase: 'regressions' });
  for (const label of ['first', 'second']) {
    mkdirSync(join(evidence, `pack-${label}`));
    requireSuccess(await run(`pack-${label}`, node, [npmCLI, 'pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', join(evidence, `pack-${label}`)], source));
  }
  const packName = JSON.parse(readFileSync(join(evidence, 'pack-first.stdout.data')))[0].filename;
  const pack = join(evidence, 'pack-first', packName); const repeatedPack = join(evidence, 'pack-second', packName);
  assert.equal(hash(readFileSync(pack)), hash(readFileSync(repeatedPack)));
  const info = JSON.parse(readFileSync(join(evidence, 'pack-first.stdout.data')))[0];
  const expected = inventory(source); assert.deepEqual(info.files.map(row => row.path).sort(), Object.keys(expected).sort());
  assert(info.files.some(row => row.path === 'README.md'));
  results.pack = { sha256: hash(readFileSync(pack)), repeatedSHA256: hash(readFileSync(repeatedPack)), members: info.files.length, readmeIncluded: true };
  const consumer = join(work, 'node_modules/consumer-initial'); mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"name":"let-author-consumer","version":"1.0.0","private":true,"type":"module"}\n');
  requireSuccess(await run('offline-install', node, [npmCLI, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--package-lock=false', pack], consumer));
  const installedRoot = join(consumer, 'node_modules/virtual-bash');
  assert.deepEqual(inventory(installedRoot), expected);
  for (const member of info.files) {
    assert.equal(lstatSync(join(installedRoot, member.path)).mode & 0o777, member.mode & 0o777, member.path);
    assert.equal(lstatSync(join(installedRoot, member.path)).mode & 0o777, lstatSync(join(source, member.path)).mode & 0o777, member.path);
  }
  results.installed = { packageFiles: Object.keys(expected).length, exact: true };
  const moved = join(work, 'node_modules/consumer-moved'); renameSync(consumer, moved); assert.equal(existsSync(consumer), false);
  const movedRoot = join(moved, 'node_modules/virtual-bash');
  assert.deepEqual(inventory(movedRoot), expected);
  results.moved = await behavior('moved', movedRoot, 'moved');
  if (results.moved.summary.failed.length) results.failures.push({ phase: 'moved', cases: results.moved.summary.failed });
  const typeCases = [
    { name: 'positive', fixture: 'consumer.mts.fixture', code: 0 },
    { name: 'negative-api', fixture: 'negative-api.mts.fixture', diagnostic: 'TS2305', token: 'createLetCommands' },
    { name: 'negative-limit', fixture: 'negative-limit.mts.fixture', diagnostic: 'TS2322', token: "Type 'string' is not assignable to type 'number'" },
    { name: 'api-inversion', fixture: 'negative-api.mts.fixture', code: 0, replace: ['createLetCommands', 'Shell'] },
    { name: 'limit-inversion', fixture: 'negative-limit.mts.fixture', code: 0, replace: ["'1024'", '1024'] },
  ];
  for (const entry of typeCases) {
    let body = readFileSync(join(evidence, `frozen-${entry.fixture}`), 'utf8'); if (entry.replace) body = body.replaceAll(...entry.replace);
    const name = `${entry.name}.mts`; writeFileSync(join(moved, name), body);
    const receipt = await run(`types-${entry.name}`, node, [tsc, '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess', '--skipLibCheck', '--typeRoots', join(work, 'node_modules/@types'), '--types', 'node', '--listFiles', '--traceResolution', name], moved);
    requireNatural(receipt);
    const diagnostics = receipt.stdout.split('\n').filter(line => /error TS\d+/u.test(line));
    const pass = entry.diagnostic ? receipt.code !== 0 && diagnostics.length === 1 && diagnostics[0].includes(entry.diagnostic) && diagnostics[0].includes(entry.token) && diagnostics[0].startsWith(`${name}(`) : receipt.code === 0 && diagnostics.length === 0;
    const leaf = join(movedRoot, 'dist/index.d.ts'); assert(receipt.stdout.includes(leaf)); assert(!receipt.stdout.includes(join(source, 'src')));
    results.types.push({ name: entry.name, pass, code: receipt.code, diagnostics, rootDeclaration: leaf, sha256: hash(readFileSync(leaf)) }); if (!pass) results.failures.push({ phase: 'types', name: entry.name });
  }
  for (const control of ['intact', 'wrong-manifest', 'wrong-root', 'source-fallback', 'wrong-runtime-hash']) {
    const binding = JSON.parse(readFileSync(results.moved.binding)); binding.harness[join(own, 'guard-control.mjs')] = hash(readFileSync(join(own, 'guard-control.mjs')));
    if (control === 'wrong-runtime-hash') binding.files['dist/shell/runtime.js'] = '0'.repeat(64);
    if (control === 'wrong-root') binding.root = source;
    const filename = join(evidence, `guard-${control}.binding.json`); const bytes = JSON.stringify(binding, null, 2) + '\n'; writeFileSync(filename, bytes);
    const receipt = await run(`guard-${control}`, node, ['--unhandled-rejections=strict', '--import', join(own, 'load-hook.mjs'), join(own, 'guard-control.mjs')], moved, { LET_BINDING: filename, LET_BINDING_SHA256: control === 'wrong-manifest' ? '0'.repeat(64) : hash(bytes), LET_LOAD_RECEIPT: join(evidence, `guard-${control}.loads.jsonl`), LET_CONTROL: control, LET_EXPECT_ROOT: movedRoot, LET_SOURCE: source });
    requireNatural(receipt);
    const pass = control === 'intact' ? receipt.code === 0 : receipt.code !== 0 && (control === 'source-fallback' ? receipt.stderr.includes('UNBOUND_MODULE:') : control === 'wrong-runtime-hash' ? receipt.stderr.includes('PRE:dist/shell/runtime.js') : control === 'wrong-root' ? receipt.stderr.includes('WRONG_ROOT') : receipt.stderr.includes('AssertionError'));
    results.controls.push({ name: control, pass, code: receipt.code }); if (!pass) results.failures.push({ phase: 'guard', control });
  }
  const mutations = JSON.parse(readFileSync(join(own, 'MUTANTS.json')));
  const originalRuntime = readFileSync(join(source, 'src/shell/runtime.ts'), 'utf8');
  for (const mutant of mutations) {
    const root = join(work, 'node_modules', `mutant-${mutant.id}`); mkdirSync(root);
    for (const binding of inputs.sourceInputs) { mkdirSync(dirname(join(root, binding.path)), { recursive: true }); copyFileSync(join(source, binding.path), join(root, binding.path)); }
    let body = originalRuntime;
    if (mutant.id === 'M0') body = readFileSync(join(evidence, 'accepted464-runtime.data'), 'utf8');
    else for (const replacement of mutant.replacements) { assert.equal(body.split(replacement.before).length - 1, 1, mutant.id); body = body.replace(replacement.before, replacement.after); }
    writeFileSync(join(root, 'src/shell/runtime.ts'), body);
    requireSuccess(await run(`build-${mutant.id}`, node, [tsc, '-p', 'tsconfig.build.json'], root));
    const observed = await behavior(`mutant-${mutant.id}`, root, 'mechanism-mutant', mutant.ids);
    const killed = mutant.designated.every(id => observed.summary.failed.includes(id));
    results.mutants.push({ id: mutant.id, killed, sourceSHA256: hash(body), runtimeSHA256: inventory(root)['dist/shell/runtime.js'], ...observed });
    if (!killed) results.failures.push({ phase: 'mutant', id: mutant.id });
  }
  requireSuccess(await run('selected-archive', '/usr/bin/bsdtar', ['-czf', join(evidence, 'selected-inputs.tar.gz'), '-C', source, ...inputs.sourceInputs.map(row => row.path)], source));
  results.archive = { sha256: hash(readFileSync(join(evidence, 'selected-inputs.tar.gz'))), inputs: inputs.sourceInputs.length, profile: 'selected committed inputs only, not whole history' };
} catch (error) { results.fatal = String(error.stack ?? error); }
try { guard(); results.postGuards = 'passed'; } catch (error) { results.postGuards = String(error.stack ?? error); }
results.finished = new Date().toISOString(); results.commands = commands.length; results.naturalGroups = commands.filter(row => row.groupAbsent && row.signal === null && row.failure === null).length;
writeFileSync(join(evidence, 'REPORT.json'), JSON.stringify(results, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ finished: results.finished, source: results.source?.summary, moved: results.moved?.summary, pack: results.pack, failures: results.failures, fatal: results.fatal, commands: results.commands, naturalGroups: results.naturalGroups, postGuards: results.postGuards }));
if (results.fatal || results.failures.length || results.postGuards !== 'passed') process.exitCode = 1;
