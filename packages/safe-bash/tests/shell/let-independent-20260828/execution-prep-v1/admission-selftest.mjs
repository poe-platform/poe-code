import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hash, save } from './artifacts.mjs';
import { supervise } from './protocol.mjs';

const scope = dirname(fileURLToPath(import.meta.url)), root = realpathSync(mkdtempSync(join(tmpdir(), 'let-admission-data-')));
const identities = () => Object.fromEntries(['admission-selftest.mjs', 'load-guard.mjs', 'support.mjs', 'protocol.mjs', 'artifacts.mjs'].map(name => [name, hash(readFileSync(join(scope, name)))]));
const report = { qualification: 'Actual Node/load-hook/read-fence controls using tiny owned data modules; NOT a LET/Shell/public-package acceptance test', started: new Date().toISOString(), files: identities(), node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) }, runs: [], productExecutions: 0, candidateBuilds: 0, scratchRemoved: false };
try {
  const forbidden = join(root, 'forbidden.mjs'); writeFileSync(forbidden, 'export const marker = "forbidden";\n');
  for (const mode of ['positive', 'changed-module', 'missing-module', 'manifest-digest', 'unbound-module', 'source-fallback', 'source-read-fence', 'symlink']) {
    const consumer = join(root, mode), data = join(consumer, 'data'), harness = join(consumer, 'harness');
    mkdirSync(data, { recursive: true }); mkdirSync(harness);
    const module = join(data, 'module.mjs'); writeFileSync(module, 'export const marker = "bounded-fixture";\n');
    writeFileSync(join(data, 'unbound.mjs'), 'export const marker = "unbound";\n');
    for (const name of ['load-guard.mjs', 'support.mjs']) copyFileSync(join(scope, name), join(harness, name));
    const target = mode === 'source-fallback' ? pathToFileURL(forbidden).href : mode === 'unbound-module' ? '../data/unbound.mjs' : '../data/module.mjs';
    writeFileSync(join(harness, 'entry.mjs'), mode === 'source-read-fence' ? `import { readFileSync } from 'node:fs'; readFileSync(${JSON.stringify(forbidden)}); throw new Error('unexpected forbidden read');\n` : `import { marker } from ${JSON.stringify(target)}; if (marker !== 'bounded-fixture') throw new Error('unexpected marker'); process.stdout.write(JSON.stringify({fixture:'ok'})+'\\n');\n`);
    const manifest = { kind: 'let-independent-loaded-candidate-v1', packageRoot: data, harnessRoot: harness, nodeSha256: report.node.sha256, files: { 'module.mjs': hash(readFileSync(module)) }, harnessFiles: Object.fromEntries(['entry.mjs', 'load-guard.mjs', 'support.mjs'].map(name => [name, hash(readFileSync(join(harness, name)))])) };
    const path = join(consumer, 'manifest.json'); save(path, manifest); const digest = hash(readFileSync(path));
    if (mode === 'changed-module') writeFileSync(module, 'export const marker = "changed";\n');
    if (mode === 'missing-module') unlinkSync(module);
    if (mode === 'symlink') { unlinkSync(module); symlinkSync(forbidden, module); }
    const run = await supervise(process.execPath, ['--permission', ...[consumer, process.execPath].map(path => `--allow-fs-read=${path}`), '--import', join(harness, 'load-guard.mjs'), join(harness, 'entry.mjs')], { cwd: consumer, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', LET_MANIFEST: path, LET_MANIFEST_SHA256: mode === 'manifest-digest' ? '0'.repeat(64) : digest }, timeoutMs: 5000 });
    const captured = { mode, run, manifest, manifestSha256: digest, checked: false }; report.runs.push(captured);
    assert.equal(run.closeObserved, true); assert.equal(run.groupAbsent, true); assert.equal(run.failure, null); assert.equal(run.spawnError, null); assert.equal(run.signal, null);
    assert.equal(run.code, mode === 'positive' ? 0 : 1, mode + '\n' + run.stderr);
    if (mode === 'positive') { assert.ok(run.stdout.includes('"fixture":"ok"')); assert.ok(run.stdout.includes('"sha256":"' + manifest.files['module.mjs'] + '"')); }
    else {
      assert.equal(run.stdout.includes('"fixture":"ok"'), false);
      const pattern = { 'changed-module': /AssertionError.*module\.mjs/su, 'missing-module': /ENOENT/u, 'manifest-digest': /manifest SHA256/u, 'unbound-module': /unbound module/u, 'source-fallback': /unbound module/u, 'source-read-fence': /ERR_ACCESS_DENIED/u, symlink: /AssertionError/u }[mode];
      assert.match(run.stderr, pattern);
      if (mode.startsWith('source-')) assert.ok(run.stderr.includes(forbidden));
    }
    captured.checked = true;
  }
  assert.deepEqual(identities(), report.files); report.inputHashesUnchanged = true;
  report.completed = true;
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { rmSync(root, { recursive: true, force: true }); report.scratchRemoved = !existsSync(root); report.finished = new Date().toISOString(); if (process.argv[2]) save(process.argv[2], report); }
process.stdout.write(JSON.stringify({ harnessDataAdmissionChildren: report.runs.length, completed: report.completed === true, scratchRemoved: report.scratchRemoved, productExecutions: 0, failure: report.failure?.message }) + '\n');
