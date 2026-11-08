import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cases, productFiles, sourceFiles } from '../bounded-matrix/cases.mjs';

export const root = new URL('../../../../', import.meta.url);
export const base = new URL('./', import.meta.url);
export const build = new URL('.build/', base);
export const scripts = ['guard.mjs', 'prepare.mjs', 'child.mjs', 'run.mjs', 'finish.mjs', 'cleanup.mjs', 'README.md', '.gitignore'];
export const json = path => JSON.parse(readFileSync(path, 'utf8'));
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = path => sha(readFileSync(path));
export const hashes = (names, directory = root) => Object.fromEntries(names.map(name => [name, digest(new URL(name, directory))]));
export const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export const evidence = id => new URL(`evidence/${id}.json`, base);
export const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export const runtime = () => ({ node: process.version, v8: process.versions.v8, executable: process.execPath,
  binary: digest(process.execPath), platform: process.platform, arch: process.arch });
export const observations = () => hashes(sourceFiles.filter(name => !productFiles.includes(name)));
export function verify() {
  const frozen = json(new URL('frozen.json', base));
  const bundle = json(new URL('source-bundle.json', base));
  const buildHashes = hashes(Object.keys(frozen.buildHashes), build);
  const sourceHashes = hashes(Object.keys(bundle.files), build);
  if (!same(runtime(), frozen.runtime) || !same(buildHashes, frozen.buildHashes)
    || !same(sourceHashes, frozen.sourceHashes) || !same(hashes(scripts, base), frozen.scripts)
    || digest(new URL('source-bundle.json', base)) !== frozen.bundleHash
    || !same(hashes(Object.keys(frozen.history)), frozen.history)) throw new Error('Frozen execution/history identity mismatch');
  return { buildHashes, sourceHashes, liveSourceHashes: hashes(productFiles), observationHashes: observations() };
}
export function loadedProof(selected, phase) {
  const frozen = json(new URL('frozen.json', base));
  const paths = frozen.runtimeClosures[selected.tool];
  const actual = hashes(paths, build);
  if (paths.some(name => actual[name] !== frozen.buildHashes[name])) throw new Error('Loaded artifact digest mismatch');
  save(new URL(`evidence/${selected.id}.loaded-${phase}.json`, base), {
    tool: selected.tool, phase, utc: new Date().toISOString(), env: process.env, execArgv: process.execArgv,
    paths: paths.map(name => new URL(name, build).pathname), hashes: actual,
    binding: 'Fixed compiled entry import; complete static ESM import/export graph, validated during compilation; builtins excluded',
  });
}
export function expected(record, selected) {
  if (record.outcome !== 'completed' || record.reason !== null || record.activechildren !== 0
    || record.cleanup.length !== 5 || !record.cleanup.every(Boolean) || record.cleanupWarning
    || record.exit[0] !== 0 || record.close[0] !== 0 || record.stderr !== '') return false;
  const observation = JSON.parse(record.stdout);
  return observation.calls === 1 && observation.nativeResult === selected.expected.nativeResult
    && observation.commandExit === selected.expected.exitCode && observation.commandError === null
    && observation.stdout === selected.expected.stdout && observation.stderr === selected.expected.stderr;
}
export function schedule(selected) {
  if (existsSync(evidence(selected.id)) || existsSync(new URL(`claims/${selected.id}.json`, base))) throw new Error('No repetitions');
  const prior = cases.slice(0, cases.indexOf(selected)).map(item => {
    const record = json(evidence(item.id));
    if (record.id !== item.id || record.kind !== item.kind || record.tool !== item.tool
      || record.executionStable !== true || record.activechildren !== 0) throw new Error('Prior identity/cleanup failure');
    if (record.outcome === 'completed') {
      if (!expected(record, item)) throw new Error('Prior expectation failure');
    } else if (record.outcome === 'parent-terminated-with-entry-marker') {
      if (item.kind !== 'nested' || record.reason !== 'execution-deadline' || !record.killAccepted
        || record.exit[1] !== 'SIGKILL' || record.cleanupWarning || record.cleanup.length !== 5
        || !record.cleanup.every(Boolean)) throw new Error('Prior watchdog failure');
    } else if (record.outcome !== 'skipped' || record.reason !== 'family-execution-watchdog' || record.pid !== null) {
      throw new Error('Prior setup/harness failure');
    }
    return record;
  });
  for (const record of prior.filter(item => item.outcome === 'skipped')) {
    if (!prior.slice(0, prior.indexOf(record)).some(item => item.tool === record.tool && item.reason === 'execution-deadline')) throw new Error('Unjustified skip');
  }
  if (selected.kind === 'nested' && prior.filter(item => item.kind === 'control' && item.outcome === 'completed').length !== 4) throw new Error('Four compiled controls required');
  if (prior.filter(item => item.kind === 'nested' && item.pid).length >= 8) throw new Error('Eight-risk ceiling');
  return prior.some(item => item.tool === selected.tool && item.reason === 'execution-deadline');
}
