import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { admit, census, digest, verifyTree } from './boundary-app.mjs';
import { supervise } from '../executor-v1/supervisor.mjs';
import { verifyTool } from './npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(here, '../../../..');
const prefix = 'tests/shell/indexed-arrays-independent-20260828/candidate-v1';
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: repository, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
const preseal = git('log', '-1', '--format=%H', '--', `${prefix}/LAYOUTS-V1-PRESEAL.md`).toString().trim();
for (const name of ['LAYOUTS-V1-PRESEAL.md', 'layout-phase-v1.mjs', 'layout-adapter-v1.mjs']) assert.equal(digest(fs.readFileSync(path.join(here, name))), digest(git('show', `${preseal}:${prefix}/${name}`)));
const work = path.join(here, 'observer-v2-run-HzBTcw'), previousPath = path.join(work, 'MECHANISMS-MANIFEST.json'), previousGo = path.join(work, 'MECHANISMS-GO.json');
assert.equal(digest(fs.readFileSync(path.join(work, 'MECHANISMS-RESULT.json'))), '61ffc6ed8a27d158dc920562d0ff9a530608ac69ab3a3d04f4f306f11a303d3f');
const prior = admit(previousPath, digest(fs.readFileSync(previousPath)), previousGo, digest(fs.readFileSync(previousGo))).manifest;
const encoded = fs.readFileSync(path.join(here, 'NPM-TOOL-INVENTORY.json.gz.base64')); assert.equal(digest(encoded), '5623653d01886efdbb55e5a4c6b387ba8af00e4b4673740caf23a482ce473af4');
const decoded = gunzipSync(Buffer.from(encoded.toString(), 'base64')); assert.equal(digest(decoded), '1a09d4358a33e162bcc6fc260258d70089a0acdc463d0b0dac56f3f232dcf4ce');
const npm = JSON.parse(decoded); verifyTool(npm);
const phase = path.join(work, 'layouts-v1'); fs.mkdirSync(phase);
const installed = path.join(phase, 'installed-app'), moved = path.join(phase, 'moved-app'); fs.mkdirSync(installed);
const put = (filename, bytes) => fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o644 });
put(path.join(installed, 'package.json'), '{"private":true,"type":"module"}\n');
for (const folder of ['home', 'cache', 'tmp']) fs.mkdirSync(path.join(phase, folder));
const report = { preseal, packageSha256: prior.packageSha256, runs: [], guards: [], unsafeStop: false, accepted: false };
try {
  report.install = await supervise(prior.node.path, [path.join(npm.root, 'bin/npm-cli.js'), 'install', '--offline', '--ignore-scripts', '--no-save', '--package-lock=false', '--no-audit', '--no-fund', prior.packageTar], { cwd: installed, env: { PATH: path.dirname(prior.node.path), HOME: path.join(phase, 'home'), TMPDIR: path.join(phase, 'tmp'), npm_config_cache: path.join(phase, 'cache'), LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 90000, maxBytes: 2 * 1024 * 1024 });
  verifyTool(npm); assert.equal(digest(fs.readFileSync(prior.node.path)), prior.node.sha256);
  assert.ok(report.install.closeObserved && report.install.groupAbsent && !report.install.fault && !report.install.signal && !report.install.spawnError); assert.equal(report.install.code, 0, report.install.stderr);
  const originals = ['worker.mjs','semantic.mjs','supervisor.mjs','run.mjs','boundary.mjs','observer-v2.mjs','terminal-adapter-v2.mjs','mechanism-adapter-v1.mjs','VECTORS.json','CONTROLS.json','HOLDOUTS.json','BASELINE.json'];
  const patches = originals.map(name => [name, fs.readFileSync(path.join(prior.harnessRoot, name), 'utf8')]);
  patches.push(['layout-adapter-v1.mjs', fs.readFileSync(path.join(here, 'layout-adapter-v1.mjs'), 'utf8')]);
  execFileSync('apply_patch', [`*** Begin Patch\n${patches.map(([name, text]) => `*** Add File: ${path.join(installed, name)}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}`).join('\n')}\n*** End Patch\n`], { cwd: repository, timeout: 10000 });
  for (const [name, text] of patches) assert.equal(digest(fs.readFileSync(path.join(installed, name))), digest(Buffer.from(text)));
  for (const layout of ['installed', 'moved']) {
    const app = layout === 'installed' ? installed : moved;
    if (layout === 'moved') { fs.renameSync(installed, moved); assert.throws(() => fs.lstatSync(installed), error => error.code === 'ENOENT'); }
    const remap = filename => filename.startsWith(prior.harnessRoot + '/') ? app + filename.slice(prior.harnessRoot.length) : filename;
    const manifest = { ...prior, layout, harnessRoot: app, packageRoot: path.join(app, 'node_modules/virtual-bash'), adapter: { path: path.join(app, 'layout-adapter-v1.mjs') }, trees: [{ root: app, entries: census(app) }, ...prior.trees.filter(tree => tree.root !== prior.harnessRoot)], requiredFiles: [...prior.requiredFiles.map(remap), path.join(app, 'layout-adapter-v1.mjs')], ...(layout === 'moved' ? { priorAppRoot: installed } : {}) };
    for (const key of ['rootModule','runtimeModule','rootDeclaration','workerModule','vectorsFile','controlsFile','holdoutsFile','baselineFile']) manifest[key] = remap(prior[key]);
    const manifestPath = path.join(phase, `${layout}-MANIFEST.json`), bytes = Buffer.from(JSON.stringify(manifest)), manifestSha = digest(bytes); put(manifestPath, bytes);
    const goPath = path.join(phase, `${layout}-GO.json`), goBytes = Buffer.from(JSON.stringify({ action: 'execute-array-candidate', rootReceipt: preseal, candidate: prior.candidate, manifestSha256: manifestSha })); put(goPath, goBytes);
    const admission = () => admit(manifestPath, manifestSha, goPath, digest(goBytes)); admission();
    const negative = (name, change, restore) => { try { change(); assert.throws(admission, /append-aware|no linked member/u); report.guards.push({ layout, name, pass: true }); } finally { restore(); } admission(); };
    for (const [name, filename] of [['changed-js', manifest.rootModule], ['changed-declaration', manifest.rootDeclaration]]) { const original = fs.readFileSync(filename); negative(name, () => fs.appendFileSync(filename, '\n'), () => fs.writeFileSync(filename, original)); }
    const backup = path.join(phase, `${layout}-runtime-backup`); negative('missing-js', () => fs.renameSync(manifest.runtimeModule, backup), () => fs.renameSync(backup, manifest.runtimeModule));
    const extra = path.join(app, 'unbound.txt'); negative('extra-member', () => put(extra, 'extra'), () => fs.unlinkSync(extra));
    const link = path.join(app, 'unbound-link'); negative('symlink', () => fs.symlinkSync(manifest.rootModule, link), () => fs.unlinkSync(link));
    const vectors = JSON.parse(fs.readFileSync(manifest.vectorsFile));
    const batches = [['semantic', [...vectors.splice, ...vectors.zeroView].map(row => row.id)], ['mechanical', ['M01','M02','M03','M04','M05','M06','M07','M09','M10','M11','M12','M13','M14','M15','M18','M19','M20']], ['operations', ['P01','P02','P06','P07']]];
    for (const [cohort, ids] of batches) {
      admission(); const output = path.join(phase, `${layout}-${cohort}.json`);
      const outer = await supervise(prior.node.path, [path.join(app, 'run.mjs'), manifestPath, manifestSha, goPath, digest(goBytes), output, cohort, JSON.stringify(ids)], { cwd: app, env: { PATH: path.dirname(prior.node.path), LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 180000, maxBytes: 2 * 1024 * 1024 });
      const capture = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : undefined; report.runs.push({ layout, cohort, ids, outer, capture });
      assert.ok(outer.closeObserved && outer.groupAbsent && !outer.fault && !outer.signal && !outer.spawnError && capture && !capture.unsafeStop, 'unsafe runtime phase'); assert.ok([0, 1].includes(outer.code));
    }
    for (const tree of manifest.trees) verifyTree(tree); verifyTool(npm); assert.equal(digest(fs.readFileSync(prior.node.path)), prior.node.sha256);
  }
  report.accepted = report.runs.length === 6 && report.runs.every(row => row.capture.verdict.accepted);
} catch (error) { report.unsafeStop = true; report.error = String(error?.stack ?? error); }
const result = Buffer.from(JSON.stringify(report)); put(path.join(phase, 'RESULT.json'), result);
console.log(JSON.stringify({ phase, accepted: report.accepted, unsafeStop: report.unsafeStop, guards: report.guards.length, runs: report.runs.map(row => ({ layout: row.layout, cohort: row.cohort, passed: row.capture?.verdict.observations.filter(item => item.pass).length, failed: row.capture?.verdict.failed, errors: row.capture?.verdict.errors })), error: report.error, sha256: digest(result) }));
process.exitCode = report.unsafeStop ? 78 : report.accepted ? 0 : 1;
