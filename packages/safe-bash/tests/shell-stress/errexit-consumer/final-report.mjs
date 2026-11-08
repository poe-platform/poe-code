import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { save, sha256 } from './support.mjs';
import { save as saveKernel, alive } from '../kernel-reconciliation/support.mjs';
const own = 'tests/shell-stress/errexit-consumer/';
const kernel = 'tests/shell-stress/kernel-reconciliation/';
const built = JSON.parse(await readFile(own + 'final-built-6e3e316.json'));
const current = JSON.parse(await readFile(kernel + 'final-snapshot-6e3e316.json'));
const previous = JSON.parse(await readFile(kernel + 'acceptance-f1bb98b.json'));
const previousRows = JSON.parse(await readFile(kernel + 'acceptance-rows.json'));
const natives = JSON.parse(await readFile(own + 'final-native-6e3e316.json'));
const revision = '6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a';
const changed36 = current.product36.filter(row => !isDeepStrictEqual(row.actual, previous.product36.find(old => old.id === row.id).actual)).map(row => row.id);
const changed57 = current.comparison57.filter(row => !isDeepStrictEqual(row.actual, previous.comparison57.find(old => old.id === row.id).actual)).map(row => row.id);
const changedHost = current.productHost.filter(row => !isDeepStrictEqual(row.actual, previous.productHost.find(old => old.id === row.id).actual)).map(row => row.id);
assert.deepEqual([changed36, changed57, changedHost], [[], [], []]);
const effects = { ...previousRows.effects };
const effectKey = value => { const hash = sha256(JSON.stringify(value)); effects[hash] = value; return hash; };
const tuple36 = value => ({ status: value.status, stdoutHex: Buffer.from(value.stdout, 'base64').toString('hex'), stderrHex: Buffer.from(value.stderr, 'base64').toString('hex'), effects: effectKey(value.entries) });
const rows = previousRows.rows.map(row => {
  const actual = row.cohort === 'expanded36' ? tuple36(current.product36.find(item => item.id === row.id).actual) : { ...current.comparison57.find(item => item.id === row.id).actual, effects: effectKey(current.comparison57.find(item => item.id === row.id).actual.effects) };
  return { ...row, afterSubstring: row.actual, actual, classification: row.id === 'env-single-kernel-argument' ? 'ROOT-approved one-literal-optional-argument policy refuses env literal bash -e. Darwin splits/executes it. Real raw capability/protocol loss retained; real -e now independently works, not a native-parity waiver.' : row.classification };
});
saveKernel('final-rows-6e3e316.json', { source: revision, baselineCommit: '3243c5a86a23408b3b844a017db6a5a94f064d1b', priorAcceptance: '3e2b880694cd252f311d8efaafd151e107e17d2f', changed36, changed57, changedHost, rows, effects });
function quoted(hex) {
  let text = '"';
  for (const byte of Buffer.from(hex, 'hex')) {
    if (byte === 10) text += '\\n';
    else if (byte === 13) text += '\\r';
    else if (byte === 9) text += '\\t';
    else if (byte === 34 || byte === 92) text += '\\' + String.fromCharCode(byte);
    else if (byte >= 32 && byte <= 126) text += String.fromCharCode(byte);
    else text += '\\x' + byte.toString(16).padStart(2, '0');
  }
  return text + '"';
}
const names = Object.fromEntries(Object.keys(effects).map((hash, index) => [hash, `E${index}`]));
const display = tuple => `(${tuple.status}, ${quoted(tuple.stdoutHex)}, ${quoted(tuple.stderrHex)}, ${names[tuple.effects]})`.replaceAll('|', '&#124;');
let table = '# Final6e exact kernel rows\n\nAll36 native-row actual tuples, all10 host observations and all57 raw invocation tuples are identical to immutable f1 acceptance3e2b880. This table retains the original15-row unresolved union, including the substring row already resolved at f1. Tuples are `(status, stdout bytes, stderr bytes, effect ID)`. Escapes encode exact bytes; invalid UTF8 is not decoded to replacement characters. Both whole native profiles were freshly confirmed without replacing old oracles.\n\n| Row | Original3243c5a | Current6e (=f1) | GNU5.3 | Historical3.2 | Classification |\n| --- | --- | --- | --- | --- | --- |\n';
for (const row of rows) table += `| ${row.cohort}: ${row.id} | \`${display(row.baseline)}\` | \`${display(row.actual)}\` | \`${display(row.profiles[0].tuple)}\` | \`${display(row.profiles[1].tuple)}\` | ${row.classification} |\n`;
table += '\n## Exact effects\n\nOriginal observation boundaries remain unchanged: expanded36 records all relative entries except native role infrastructure; invocation57 tracks only original effect/fd-output names. Full fixtures/sources and maps are in final-rows-6e3e316.json.\n\n';
for (const [hash, name] of Object.entries(names)) table += `- ${name}: \`${hash}\` = \`${JSON.stringify(effects[hash])}\`\n`;
saveKernel('FINAL_ROWS.md', table);
const compiledImportChecks = built.product.map(row => ({ id: row.id, valid: row.valid, resolved: row.actual.resolved, imports: Object.keys(row.actual.loaded).length, mismatches: Object.entries(row.actual.loaded).filter(([path, hash]) => built.emittedBefore[path] !== hash), sourceAliases: Object.keys(row.actual.loaded).filter(path => !path.startsWith('dist/') || !path.endsWith('.js')) }));
const sourceProof = Object.entries(built.archivedFiles).filter(([, entry]) => entry.sha256).map(([path, entry]) => ({ path, hash: entry.sha256, matchesCommit: sha256(execFileSync('git', ['show', `${revision}:${path}`], { maxBuffer: 8e6 })) === entry.sha256 }));
assert.ok(sourceProof.every(row => row.matchesCommit));
const pids = [...new Set([...current.children.map(row => row.pid), ...built.phases.map(phase => phase.run.pid), ...built.product.map(row => row.run.pid)])];
const publicLosses = built.product.filter(row => row.kind === 'native' && row.profiles.some(profile => !profile.passed)).map(row => ({ id: row.id, actual: row.actual.observation, profiles: natives.profiles.map(profile => ({ role: profile.role, tuple: profile.rows.find(native => native.id === row.id).tuple, passed: row.profiles.find(item => item.role === profile.role).passed })) }));
const removed = async path => access(path).then(() => false, error => error.code === 'ENOENT');
const currentSources = Object.fromEntries(await Promise.all(['src/shell/runtime.ts', 'src/shell/parser.ts', 'package.json'].map(async path => [path, sha256(await readFile(path))])));
save('final-audit.json', { at: new Date().toISOString(), revision, scope: 'Full committed6e source, not latest live aggregate', sourceProof, compiledImportChecks, builtSummary: built.summary, publicLosses, kernelSummary: current.metadata.summary, changed36, changed57, changedHost, nativeDrift: { consumer: current.metadata.nativeDrift10, expanded: current.metadata.nativeDrift36, invocation: current.metadata.nativeDrift57 }, kernelPhaseGuards: current.phases.map(phase => ({ id: phase.id, valid: phase.valid, sourceImports: Object.keys(current.manifests[phase.loaded]).filter(path => path.startsWith('src/')).length, mismatches: phase.mismatch, drift: phase.drift })), immutableDrift: current.metadata.immutableDrift, endpoint: current.metadata.endpoint, compilers: current.compilerPhases.map(phase => ({ id: phase.id, status: phase.run.status, inputs: phase.actualCount, validGuard: phase.valid, diagnostics: phase.diagnostics, drift: phase.drift, unlisted: phase.unlisted, headBefore: phase.headBefore, headAfter: phase.headAfter })), currentSourcesForQualificationOnly: currentSources, cleanup: { publicSnapshotRemoved: await removed(built.snapshot), kernelSnapshotRemoved: await removed(current.metadata.snapshot) }, children: pids.map(pid => ({ pid, groupAlive: alive(pid) })), toolchainAtAudit: { node: process.version, tsxPackageHash: sha256(await readFile('node_modules/tsx/package.json')), tsxVersion: JSON.parse(await readFile('node_modules/tsx/package.json')).version, typescriptVersion: JSON.parse(await readFile('node_modules/typescript/package.json')).version }, limits: 'No hidden-case/author denominator pooling. Frozen global exits2 because self-export declarations were not emitted into that separate kernel snapshot; built consumer used its own successful build. Qualified live global exits2 on foreign test TS7053. Neither rerun/repaired.' });
console.log(JSON.stringify({ built: built.summary, kernel: current.metadata.summary, changed36, changed57, changedHost, groups: pids.length, live: pids.filter(alive), sourceProof: sourceProof.length, publicLosses: publicLosses.map(row => row.id) }));
