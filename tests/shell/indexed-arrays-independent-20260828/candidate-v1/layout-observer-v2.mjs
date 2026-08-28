import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { admit, census, digest, verifyTree } from './boundary-app.mjs';
import { supervise } from '../executor-v1/supervisor.mjs';
import { verifyTool } from './npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(here, '../../../..');
const prefix = 'tests/shell/indexed-arrays-independent-20260828/candidate-v1';
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: repository, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
const preseal = git('log', '-1', '--format=%H', '--', `${prefix}/LAYOUT-OBSERVER-V2-PRESEAL.md`).toString().trim();
for (const name of ['LAYOUT-OBSERVER-V2-PRESEAL.md', 'layout-observer-v2.mjs', 'layout-adapter-v2.mjs']) assert.equal(digest(fs.readFileSync(path.join(here, name))), digest(git('show', `${preseal}:${prefix}/${name}`)));
const work = path.join(here, 'observer-v2-run-HzBTcw'), layouts = path.join(work, 'layouts-v1');
assert.equal(digest(fs.readFileSync(path.join(layouts, 'RESULT.json'))), '45d238f3c592c4aa9f7603a40c14de85daba71abfa0fd2e99e65c63a21377058');
const priorPath = path.join(layouts, 'moved-MANIFEST.json'), priorGo = path.join(layouts, 'moved-GO.json');
const prior = admit(priorPath, digest(fs.readFileSync(priorPath)), priorGo, digest(fs.readFileSync(priorGo))).manifest;
const encoded = fs.readFileSync(path.join(here, 'NPM-TOOL-INVENTORY.json.gz.base64')); assert.equal(digest(encoded), '5623653d01886efdbb55e5a4c6b387ba8af00e4b4673740caf23a482ce473af4');
const decoded = gunzipSync(Buffer.from(encoded.toString(), 'base64')); assert.equal(digest(decoded), '1a09d4358a33e162bcc6fc260258d70089a0acdc463d0b0dac56f3f232dcf4ce'); const npm = JSON.parse(decoded); verifyTool(npm);
const phase = path.join(work, 'layout-observer-v2'); fs.mkdirSync(phase);
const put = (filename, bytes) => fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o644 });
const patch = (filename, text) => execFileSync('apply_patch', [`*** Begin Patch\n*** Add File: ${filename}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`], { cwd: repository, timeout: 10000 });
const wrapper = fs.readFileSync(path.join(here, 'layout-adapter-v2.mjs'), 'utf8');
const report = { preseal, synthetic: { executed: 0, passed: 0 }, runs: [], unsafeStop: false };
try {
  const synthetic = path.join(phase, 'synthetic'); fs.mkdirSync(synthetic);
  patch(path.join(synthetic, 'layout-adapter-v2.mjs'), wrapper);
  patch(path.join(synthetic, 'terminal-adapter-v2.mjs'), "export const supportedIds = ['O11'];\nexport function observeTerminalState(value) { return value; }\n");
  patch(path.join(synthetic, 'mechanism-adapter-v1.mjs'), "export const candidate = 'synthetic-not-product';\nexport const supportedIds = ['M01', 'M02'];\nexport function execute() { throw false; }\n");
  const tree = { root: synthetic, entries: census(synthetic) };
  const actual = await import(pathToFileURL(path.join(synthetic, 'layout-adapter-v2.mjs'))), terminal = await import(pathToFileURL(path.join(synthetic, 'terminal-adapter-v2.mjs'))), mechanisms = await import(pathToFileURL(path.join(synthetic, 'mechanism-adapter-v1.mjs')));
  const check = action => { report.synthetic.executed++; action(); report.synthetic.passed++; };
  check(() => assert.deepEqual(Object.getOwnPropertyNames(actual), ['candidate','execute','observeTerminalState','supportedIds']));
  check(() => assert.equal(actual.candidate, 'synthetic-not-product'));
  check(() => assert.deepEqual(actual.supportedIds, ['O11','M01','M02']));
  check(() => assert.equal(actual.observeTerminalState, terminal.observeTerminalState));
  check(() => assert.equal(actual.execute, mechanisms.execute));
  check(() => { const sentinel = {}; assert.equal(actual.observeTerminalState(sentinel), sentinel); });
  check(() => { let caught = false; try { actual.execute(); } catch (reason) { caught = true; assert.equal(reason, false); } assert.equal(caught, true); });
  verifyTree(tree); report.synthetic.tree = tree;
  patch(path.join(prior.harnessRoot, 'layout-adapter-v2.mjs'), wrapper);
  for (const label of ['moved', 'restored-installed']) {
    const app = label === 'moved' ? prior.harnessRoot : path.join(layouts, 'restored-installed-app');
    if (label !== 'moved') { fs.renameSync(prior.harnessRoot, app); assert.throws(() => fs.lstatSync(prior.harnessRoot), error => error.code === 'ENOENT'); }
    const remap = filename => filename.startsWith(prior.harnessRoot + '/') ? app + filename.slice(prior.harnessRoot.length) : filename;
    const manifest = { ...prior, layout: label === 'moved' ? 'moved' : 'installed', harnessRoot: app, packageRoot: remap(prior.packageRoot), adapter: { path: path.join(app, 'layout-adapter-v2.mjs') }, requiredFiles: [...prior.requiredFiles.map(remap), path.join(app, 'layout-adapter-v2.mjs')], trees: [{ root: app, entries: census(app) }, ...prior.trees.filter(tree => tree.root !== prior.harnessRoot)] };
    for (const key of ['rootModule','runtimeModule','rootDeclaration','workerModule','vectorsFile','controlsFile','holdoutsFile','baselineFile']) manifest[key] = remap(prior[key]);
    const manifestPath = path.join(phase, `${label}-MANIFEST.json`), bytes = Buffer.from(JSON.stringify(manifest)), manifestSha = digest(bytes); put(manifestPath, bytes);
    const goPath = path.join(phase, `${label}-GO.json`), goBytes = Buffer.from(JSON.stringify({ action: 'execute-array-candidate', rootReceipt: preseal, candidate: prior.candidate, manifestSha256: manifestSha })); put(goPath, goBytes);
    admit(manifestPath, manifestSha, goPath, digest(goBytes));
    const output = path.join(phase, `${label}-RUN.json`);
    const outer = await supervise(prior.node.path, [path.join(app, 'run.mjs'), manifestPath, manifestSha, goPath, digest(goBytes), output, 'semantic', '["O11"]'], { cwd: app, env: { PATH: path.dirname(prior.node.path), LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 180000, maxBytes: 2 * 1024 * 1024 });
    const capture = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : undefined; report.runs.push({ label, outer, capture });
    assert.ok(outer.closeObserved && outer.groupAbsent && !outer.fault && !outer.signal && !outer.spawnError && capture && !capture.unsafeStop); assert.ok([0, 1].includes(outer.code));
    for (const tree of manifest.trees) verifyTree(tree); verifyTool(npm); assert.equal(digest(fs.readFileSync(prior.node.path)), prior.node.sha256);
  }
} catch (error) { report.unsafeStop = true; report.error = String(error?.stack ?? error); }
const bytes = Buffer.from(JSON.stringify(report)); put(path.join(phase, 'RESULT.json'), bytes);
console.log(JSON.stringify({ phase, synthetic: report.synthetic, unsafeStop: report.unsafeStop, runs: report.runs.map(row => ({ label: row.label, accepted: row.capture?.verdict.accepted, failed: row.capture?.verdict.failed, errors: row.capture?.verdict.errors })), error: report.error, sha256: digest(bytes) }));
process.exitCode = report.unsafeStop ? 78 : report.runs.length === 2 && report.runs.every(row => row.capture.verdict.accepted) ? 0 : 1;
