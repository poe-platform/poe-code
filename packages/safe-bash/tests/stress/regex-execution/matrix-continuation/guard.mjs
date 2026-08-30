import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { cases, flags, limits, productFiles, sourceFiles } from '../bounded-matrix/cases.mjs';

export const base = 'tests/stress/regex-execution/matrix-continuation/';
export const original = 'tests/stress/regex-execution/bounded-matrix/';
export const root = new URL('../../../../', import.meta.url);
export const scripts = ['guard.mjs', 'run.mjs', 'freeze.mjs'];
export const cleanEnv = { LANG: 'C', LC_ALL: 'C', __CF_USER_TEXT_ENCODING: '0x1F5:0x0:0x0' };
export const oldHarness = ['cases.mjs', 'child.mjs', 'run.mjs', 'snapshot.mjs'].map(name => original + name);
export const executionFiles = [...productFiles, ...oldHarness, 'package.json', 'tsconfig.json', ...scripts.map(name => base + name), base + 'README.md'];
export const observationFiles = sourceFiles.filter(name => !productFiles.includes(name) && !oldHarness.includes(name));
export const read = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
export const digest = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
export const hashes = names => Object.fromEntries(names.map(name => [name, digest(new URL(name, root))]));
export const remaining = cases.slice(1);
export const evidence = id => new URL(`${base}evidence/${id}.json`, root);
export function boundaries() {
  const names = new Set();
  for (const filename of executionFiles) {
    const parts = filename.split('/');
    parts.pop();
    while (parts.length) { names.add(parts.join('/') + '/package.json'); parts.pop(); }
  }
  return Object.fromEntries([...names].sort().map(name => [name, existsSync(new URL(name, root)) ? digest(new URL(name, root)) : null]));
}
export function runtime() {
  return { node: process.version, v8: process.versions.v8, executable: process.execPath,
    binaryDigest: digest(process.execPath), platform: process.platform, arch: process.arch,
    flags: process.execArgv, env: Object.fromEntries(Object.entries(process.env).sort()),
    childFlags: [...flags, '--experimental-strip-types', '--no-warnings'], childEnv: { LANG: 'C', LC_ALL: 'C' } };
}
export const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export function snapshot() {
  return { executionHashes: hashes(executionFiles), observationHashes: hashes(observationFiles), boundaries: boundaries(), runtime: runtime() };
}
export function guard(frozen, current) {
  const changed = Object.keys(current.executionHashes).filter(name => current.executionHashes[name] !== frozen.executionHashes[name]);
  if (!same(Object.keys(frozen.executionHashes), executionFiles) || changed.length
    || !same(frozen.boundaries, current.boundaries) || !same(frozen.runtime, current.runtime)
    || !same(frozen.ids, remaining.map(item => item.id)) || !same(frozen.limits, limits)
    || !same(readdirSync(new URL(base, root)).filter(name => name.endsWith('.mjs')).sort(), [...scripts].sort())
    || !same(hashes(Object.keys(frozen.originalEvidenceHashes)), frozen.originalEvidenceHashes)) {
    throw new Error(`Hard execution/evidence/runtime/config drift; stop: ${changed.join(',')}`);
  }
}
export function expected(record, selected) {
  if (record.id !== selected.id || record.tool !== selected.tool || record.kind !== selected.kind
    || record.outcome !== 'completed' || record.reason !== null || record.activechildren !== 0
    || !record.cleanup?.every(Boolean) || record.cleanup.length !== 5 || record.cleanupWarning
    || record.exit?.[0] !== 0 || record.close?.[0] !== 0 || record.stderr !== '') return false;
  const observation = JSON.parse(record.stdout);
  return observation.calls === 1 && observation.nativeResult === selected.expected.nativeResult
    && observation.commandExit === selected.expected.exitCode && observation.commandError === null
    && observation.stdout === selected.expected.stdout && observation.stderr === '';
}
export function schedule(selected) {
  if (existsSync(evidence(selected.id)) || existsSync(new URL(`${base}claims/${selected.id}.json`, root))) throw new Error('Case already attempted/recorded; no repetitions');
  const first = read(`${original}evidence/${cases[0].id}.json`);
  if (!expected(first, cases[0]) || first.sourceStable !== true) throw new Error('Original first control invalid');
  const prior = remaining.slice(0, remaining.indexOf(selected)).map(item => {
    const record = read(`${base}evidence/${item.id}.json`);
    if (record.id !== item.id || record.tool !== item.tool || record.kind !== item.kind
      || record.executionStable !== true || record.activechildren !== 0) throw new Error('Prior identity/drift/cleanup failure; stop');
    if (record.outcome === 'completed') {
      if (!expected(record, item)) throw new Error('Prior expected-completion failure; stop');
    } else if (record.outcome === 'parent-terminated-with-entry-marker') {
      if (item.kind !== 'nested' || record.reason !== 'execution-deadline' || !record.killAccepted
        || record.exit?.[1] !== 'SIGKILL' || record.cleanupWarning || !record.cleanup?.every(Boolean)
        || record.cleanup.length !== 5) throw new Error('Prior watchdog/cleanup failure; stop');
    } else if (record.outcome !== 'skipped' || record.reason !== 'family-execution-watchdog' || record.pid !== null) {
      throw new Error('Prior failure; stop');
    }
    return record;
  });
  for (const record of prior.filter(item => item.outcome === 'skipped')) {
    if (!prior.slice(0, prior.indexOf(record)).some(item => item.tool === record.tool && item.reason === 'execution-deadline')) throw new Error('Unjustified family skip');
  }
  if (selected.kind === 'nested' && prior.filter(item => item.kind === 'control' && item.outcome === 'completed').length !== 3) throw new Error('Four controls required before risk');
  if (prior.filter(item => item.kind === 'nested' && item.pid).length >= limits.riskyTotal) throw new Error('Risky invocation ceiling');
  return prior.some(item => item.tool === selected.tool && item.reason === 'execution-deadline');
}
