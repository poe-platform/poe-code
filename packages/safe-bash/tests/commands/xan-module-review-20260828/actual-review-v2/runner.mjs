import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ROOT, OLD, NODE, json, hash, identity, tree, verifyTree, durable, frozen } from './common.mjs';
import { supervise } from '../preparation-v2/supervisor.mjs';
import { admitFinal } from '../actual-review-v1/a01.mjs';

const recipeCommit = process.argv[2]; assert.match(recipeCommit, /^[a-f0-9]{40}$/);
const seal = await json(path.join(ROOT, 'PRE-SEAL.json')); const admission = await json(path.join(OLD, 'evidence/ADMISSION.json'));
const evidence = path.join(ROOT, 'evidence'); await mkdir(evidence);
const children = []; const outcomes = []; const phases = []; const seen = new Set(); let stopped; let sourceEntries;
const source = path.join(OLD, 'work/source'); const tools = path.join(OLD, 'work/tools'); const installed = path.join(OLD, 'work/installed-moved'); const build = path.join(ROOT, 'build');
const compiler = path.join(tools, 'node_modules/typescript/lib/tsc.js'); const types = path.join(tools, 'node_modules/@types');
const documents = await frozen(); const sealIdentity = await identity(path.join(ROOT, 'PRE-SEAL.json'));
async function verify() {
  assert.deepEqual(await identity(path.join(ROOT, 'PRE-SEAL.json')), sealIdentity);
  for (const entry of seal.inputs) { const { path: filename, ...expected } = entry; assert.deepEqual(await identity(filename), expected); }
  await verifyTree(source, admission.source); await verifyTree(tools, admission.tools); await verifyTree(installed, admission.installed);
  if (sourceEntries) await verifyTree(build, sourceEntries);
}
async function child(id, args, reads, writes = []) {
  const receipt = await supervise({ executable: NODE, args: ['--permission', '--disallow-code-generation-from-strings', '--disable-proto=throw', ...reads.map(name => `--allow-fs-read=${name}`), ...writes.map(name => `--allow-fs-write=${name}`), ...args],
    cwd: ROOT, directory: path.join(evidence, id), timeoutMs: 60000, rawBytes: 32 * 1024 * 1024, kind: id });
  children.push({ id, ...receipt }); await verify();
  const rawFile = await open(path.join(evidence, id, 'stdout.raw'), 'r'); const buffer = Buffer.alloc(1024 * 1024);
  const { bytesRead } = await rawFile.read(buffer); await rawFile.close();
  const preview = await open(path.join(evidence, id, 'stdout.preview'), 'wx'); await preview.writeFile(buffer.subarray(0, bytesRead)); await preview.sync(); await preview.close();
  assert.ok(receipt.reaped && !receipt.timeout && !receipt.overflow && !receipt.signal && !receipt.spawnError, 'child unsafe/incomplete: stop dependents');
  return receipt;
}
async function compile(id, files, readRoots, outDir) {
  const args = [compiler, ...files, '--pretty', 'false', '--typeRoots', types, '--types', 'node', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--skipLibCheck'];
  if (outDir) args.push('--outDir', outDir, '--noEmitOnError'); else args.push('--noEmit');
  return child(id, args, [compiler, tools, ...readRoots], outDir ? [outDir] : []);
}
await durable(path.join(evidence, 'PRE-RUN.json'), { started: new Date().toISOString(), recipeCommit, sealIdentity, source: seal.source, base: seal.base, manifestSha256: seal.manifestSha256, cohort: 1, noRetry: true });
try {
  await verify(); await mkdir(build); await mkdir(path.join(build, 'dist'));
  await durable(path.join(build, 'package.json'), { type: 'module', private: true });
  const receipt = await compile('build', ['--project', path.join(source, 'tsconfig.build.json')], [source], path.join(build, 'dist'));
  phases.push({ id: 'build', status: receipt.code === 0 ? 'PASS' : 'FAIL' }); assert.equal(receipt.code, 0, 'one independent compiler emission failed');
  sourceEntries = await tree(build);
  const comparisons = [];
  for (const entry of sourceEntries.filter(entry => /\.(js|d\.ts)$/.test(entry.path))) {
    const member = admission.installed.find(member => member.path === entry.path); assert.ok(member, `pack member ${entry.path}`);
    comparisons.push({ path: entry.path, sourceSha256: entry.sha256, installedSha256: member.sha256, equal: entry.sha256 === member.sha256 });
  }
  await durable(path.join(evidence, 'EMISSION.json'), { entries: sourceEntries, comparisons, independentlyCompiled: true, independentlyPacked: false });
  assert.ok(comparisons.every(entry => entry.equal), 'independent executable/declaration emission differs');
  for (const layout of ['SOURCE', 'INSTALLED_MOVED']) {
    const root = layout === 'SOURCE' ? build : installed;
    for (const polarity of ['positive', 'negative']) {
      const filename = path.join(evidence, `${layout}-${polarity}.mts`);
      const template = await readFile(path.join(ROOT, `consumer-${polarity}.mts`), 'utf8');
      const text = template.replaceAll('./build/dist/', path.relative(evidence, path.join(root, 'dist')).replaceAll('\\', '/') + '/');
      const file = await open(filename, 'wx'); await file.writeFile(text); await file.sync(); await file.close();
      const result = await compile(`types-${layout}-${polarity}`, [filename], [filename, root]);
      const diagnostics = await readFile(path.join(evidence, `types-${layout}-${polarity}/stdout.raw`), 'utf8');
      const errors = [...diagnostics.matchAll(/\((\d+),\d+\): error TS(\d+):/g)].map(match => ({ line: Number(match[1]), code: Number(match[2]) }));
      const expectedLines = [2, 3, 4, 5, 6, 7, 8];
      const passed = polarity === 'positive' ? result.code === 0 && !errors.length : result.code === 2 && JSON.stringify(errors.map(error => error.line)) === JSON.stringify(expectedLines);
      phases.push({ id: `types-${layout}-${polarity}`, status: passed ? 'PASS' : 'FAIL', errors, consumer: await identity(filename) });
    }
  }
  const denials = await child('write-denials', [path.join(ROOT, 'denials.mjs'), path.join(source, 'src/commands/xan/index.ts'), compiler, path.join(ROOT, 'PROTOCOL.md')], [path.join(ROOT, 'denials.mjs')]);
  phases.push({ id: 'write-denials', status: denials.code === 0 ? 'PASS' : 'FAIL' });
  for (const layout of ['SOURCE', 'INSTALLED_MOVED']) {
    const root = layout === 'SOURCE' ? build : installed; const entries = layout === 'SOURCE' ? sourceEntries : admission.installed;
    const builtinMap = {};
    for (const entry of entries.filter(entry => entry.path.endsWith('.js'))) {
      const text = await readFile(path.join(root, entry.path), 'utf8'); builtinMap[entry.path] = [...new Set([...text.matchAll(/(?:from\s*|import\s*\()?["'](node:[^"']+)["']/g)].map(match => match[1]))];
    }
    const batches = []; let pending = [];
    for (const job of seal.cohort.jobs) {
      if (job.kind === 'resource' && job.scale === 'DEFAULT') { if (pending.length) { batches.push(pending); pending = []; } batches.push([job]); }
      else { pending.push(job); if (pending.length === 40) { batches.push(pending); pending = []; } }
    }
    if (pending.length) batches.push(pending);
    for (const [index, jobs] of batches.entries()) {
      const id = `${layout}-${String(index).padStart(3, '0')}`;
      const job = { job: id, phase: 'ACTUAL_MODULE', nonce: randomUUID(), manifest: seal.manifestSha256, requiredIds: jobs.map(job => job.id), rawBound: 32 * 1024 * 1024,
        layout, root, entries, builtinMap, fallback: path.join(source, 'src/commands/xan/index.ts'), jobs, documents, rows: seal.cohort.rows, limits: seal.cohort.limits };
      const filename = path.join(evidence, `${id}.json`); await durable(filename, job); const jobIdentity = await identity(filename);
      const receipt = await child(id, [path.join(ROOT, 'worker.mjs'), filename, jobIdentity.sha256], [...seal.inputs.map(entry => entry.path).filter(name => /\.mjs$/.test(name)), filename, root]);
      const final = await admitFinal({ expected: job, processReceipt: receipt, rawFile: path.join(evidence, id, 'stdout.raw'), seen, verify,
        capture: record => durable(path.join(evidence, id, 'RAW-ADMISSION.json'), record) });
      const records = (await readFile(path.join(evidence, id, 'stdout.raw'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      outcomes.push(...records.filter(record => record.stage === 'CASE').map(record => ({ layout, job: id, raw: `${id}/stdout.raw`, ...record })));
      await durable(path.join(evidence, id, 'FINAL-ADMISSION.json'), final);
      console.log(JSON.stringify({ layout, batch: index + 1, batches: batches.length, completed: jobs.length, failures: final.failures }));
    }
  }
} catch (error) { stopped = { name: error.name, message: error.message, stack: error.stack }; }
await durable(path.join(evidence, 'CHILDREN.json'), children);
await durable(path.join(evidence, 'OUTCOMES.json'), outcomes);
const required = seal.cohort.jobs.map(job => job.id); const perLayout = {};
for (const layout of ['SOURCE', 'INSTALLED_MOVED']) {
  const records = outcomes.filter(record => record.layout === layout);
  perLayout[layout] = { pass: records.filter(record => record.status === 'PASS').length, fail: records.filter(record => record.status === 'FAIL').length, blocked: records.filter(record => record.status === 'BLOCKED').length,
    missing: required.filter(id => !records.some(record => record.id === id)), failedIds: records.filter(record => record.status === 'FAIL').map(record => record.id) };
}
const mapping = await json(path.resolve(ROOT, '../preparation-v2/CASE-MAP.json'));
const coverage = mapping.obligations.map(obligation => {
  const family = obligation.kind === 'family' ? documents['final-freeze-v3/CONTROLS.json'].families.find(family => family.id === obligation.id) : undefined;
  const related = required.filter(id => obligation.kind === 'ratification' ? id.startsWith(obligation.id) : family ? id.startsWith(obligation.id) || family.caseIds.some(caseId => id.startsWith(caseId + '/')) : obligation.kind === 'cap' ? id.includes(obligation.id) : id.startsWith(obligation.id + '/'));
  return { ...obligation, candidateState: 'ACTUAL_REVIEW_V2_SEPARATE_OUTCOMES', actualIds: related, layouts: Object.fromEntries(['SOURCE', 'INSTALLED_MOVED'].map(layout => [layout, related.map(id => ({ id, status: outcomes.find(record => record.layout === layout && record.id === id)?.status ?? 'UNRUN' }))])),
    certification: ['family', 'cap'].includes(obligation.kind) ? 'ACTUAL_PROBES_NOT_AUTOMATIC_FULL_FAMILY_OR_DEFAULT_CERTIFICATION' : related.length ? 'ACTUAL_OUTCOMES_SEPARATE_FROM_OBLIGATION_COUNTS' : 'UNMET_MAPPING_NO_PASS' };
});
await durable(path.join(evidence, 'COVERAGE.json'), { obligations: coverage, count: coverage.length, noSyntheticProductCredit: true });
const exitCode = stopped || phases.some(phase => phase.status !== 'PASS') || Object.values(perLayout).some(result => result.fail || result.blocked || result.missing.length) ? 1 : 0;
await durable(path.join(evidence, 'RESULT.json'), { classification: 'ACTUAL_AUTHORIZED_INDEPENDENT_MODULE_REVIEW_NOT_FULL_ACCEPTANCE', recipeCommit, ended: new Date().toISOString(), exitCode, stopped, phases, perLayout,
  children: { started: children.length, reaped: children.filter(child => child.reaped).length }, candidate: seal.source, base: seal.base, manifestSha256: seal.manifestSha256,
  native: 0, retries: 0, independentCompilation: phases.find(phase => phase.id === 'build')?.status, independentPack: false, noDurationOrSuperiorityClaim: true });
console.log(JSON.stringify({ exitCode, stopped, phases, perLayout, children: children.length })); process.exitCode = exitCode;
