import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { save, sha256, sourceStamp, immutable, alive } from './acceptance-support.mjs';

const owned = 'tests/shell-stress/kernel-reconciliation/';
const load = async name => JSON.parse(await readFile(owned + name));
const original = await load('baseline-recovered.json');
const priorRows = await load('unresolved-rows.json');
const current = await load('acceptance-f1bb98b.json');
const compiler = await load('acceptance-compilers-f1bb98b.json');
const effects = { ...priorRows.effects };
const effectKey = value => {
  const hash = sha256(JSON.stringify(value));
  effects[hash] = value;
  return hash;
};
const tuple36 = value => ({ status: value.status, stdoutHex: Buffer.from(value.stdout, 'base64').toString('hex'), stderrHex: Buffer.from(value.stderr, 'base64').toString('hex'), effects: effectKey(value.entries) });
const tuple57 = value => ({ ...value, effects: effectKey(value.effects) });
const rows = priorRows.rows.map(row => {
  const actualRow = row.cohort === 'expanded36' ? current.product36.find(item => item.id === row.id) : current.comparison57.find(item => item.id === row.id);
  const actual = row.cohort === 'expanded36' ? tuple36(actualRow.actual) : tuple57(actualRow.actual);
  return { ...row, baseline: row.actual, actual, profiles: row.profiles.map(profile => ({ ...profile, baselinePassed: profile.passed, passed: isDeepStrictEqual(actual, profile.tuple) })), classification: row.id === 'parameter-existing-controls' ? 'Resolved exact frozen scalar-substring control; no scalar-family or byte-locale parity claim.' : row.classification };
});
const changes36 = current.product36.filter(row => !isDeepStrictEqual(row.actual, original.product36.find(prior => prior.id === row.id).actual)).map(row => row.id);
const changes57 = current.comparison57.filter(row => !isDeepStrictEqual(row.actual, original.comparison57.find(prior => prior.id === row.id).actual)).map(row => row.id);
const changesHost = current.productHost.filter(row => !isDeepStrictEqual(row.actual, original.productHost.find(prior => prior.id === row.id).actual)).map(row => row.id);
assert.deepEqual(changes36, ['parameter-existing-controls']);
assert.deepEqual(changes57, []);
assert.deepEqual(changesHost, []);
save('acceptance-rows.json', { baselineCommit: '3243c5a86a23408b3b844a017db6a5a94f064d1b', sourceCommit: 'f1bb98b4ec8fd9cc198959e85f96e38880e72243', comparison: 'Complete baseline15-row unresolved union retained, including now-resolved row. Exact hex bytes; effect maps content-addressed. Fresh complete native captures independently agree with these unchanged frozen references.', changes36, changes57, changesHost, rows, effects });
function bytes(hex) {
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
const display = tuple => `(${tuple.status}, ${bytes(tuple.stdoutHex)}, ${bytes(tuple.stderrHex)}, ${names[tuple.effects]})`.replaceAll('|', '&#124;');
let table = '# Acceptance: exact baseline/current/native tuples\n\nEach tuple is `(status, stdout bytes, stderr bytes, effects ID)`. Escapes encode exact bytes: `\\n`, `\\r`, `\\t`, `\\\\`, `\\"`, `\\xHH`. Invalid UTF-8 is not decoded to replacement characters. All15 originally unresolved rows remain in this table;14 still fail at least one whole profile. No per-row profile, argv/name, diagnostic or mode normalization.\n\n| Row | Immutable baseline3243c5a | Current f1bb98b | GNU5.3 primary | Bash3.2 historical | Classification |\n| --- | --- | --- | --- | --- | --- |\n';
for (const row of rows) table += `| ${row.cohort}: ${row.id} | \`${display(row.baseline)}\` | \`${display(row.actual)}\` | \`${display(row.profiles[0].tuple)}\` | \`${display(row.profiles[1].tuple)}\` | ${row.classification} |\n`;
table += '\n## Exact effect-map lookup\n\nThese are the original observation boundaries: expanded36 complete entries excluding native role infrastructure; invocation57 only the original tracked `effect` and `fd-output` names. Every fixture/source and exact effect map is retained in `acceptance-rows.json`.\n\n';
for (const [hash, name] of Object.entries(names)) table += `- ${name}: \`${hash}\` = \`${JSON.stringify(effects[hash])}\`\n`;
save('ACCEPTANCE_ROWS.md', table);
const first = current.manifests[current.phases[0].before];
const last = current.manifests[current.phases.at(-1).after];
const endpointDrift = [...new Set([...Object.keys(first), ...Object.keys(last)])].filter(path => first[path] !== last[path]);
const importedSources = Object.fromEntries(current.phases.flatMap(phase => Object.entries(current.manifests[phase.loaded]).filter(([path]) => path.startsWith('src/'))));
const committedImports = Object.fromEntries(Object.keys(importedSources).sort().map(path => [path, sha256(execFileSync('git', ['show', `f1bb98b4ec8fd9cc198959e85f96e38880e72243:${path}`]))]));
const sourceMismatch = Object.keys(importedSources).filter(path => importedSources[path] !== committedImports[path]);
const sourcePaths = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', 'f1bb98b4ec8fd9cc198959e85f96e38880e72243', '--', 'src'], { encoding: 'utf8' }).trim().split('\n'));
const uncommittedSourcePaths = Object.keys(first).filter(path => path.startsWith('src/') && !sourcePaths.has(path));
const references = {};
for (const path of ['tests/shell/substring-report.md', 'tests/shell/substring-validation.json', 'tests/shell-stress/substring-holdout/ACCEPTANCE.md', 'tests/shell-stress/substring-holdout/acceptance-audit.json']) references[path] = sha256(await readFile(path));
const pids = [...new Set([...current.children, ...compiler.children].map(row => row.pid))];
const final = await sourceStamp();
assert.equal(final.valid, true);
save('acceptance-audit.json', { at: new Date().toISOString(), final, immutable, summary: current.summary, changes36, changes57, changesHost, unresolvedPrimary36: rows.filter(row => row.cohort === 'expanded36' && !row.profiles[0].passed).map(row => row.id), unresolvedPrimary57: rows.filter(row => row.cohort === 'invocation57' && !row.profiles[0].passed).map(row => row.id), perPhaseGuardInvalid: current.phases.filter(phase => !phase.valid).map(phase => phase.id), endpointDrift, importedSources, committedImports, sourceMismatch, uncommittedSourcePaths, compiler: compiler.phases.map(phase => ({ id: phase.id, status: phase.run.status, inputs: phase.actualCount, guardValid: phase.valid, diagnostics: phase.diagnostics, fixedDrift: phase.fixedDrift, inventoryDrift: phase.inventoryDrift })), references, externalEvidence: 'Author105/132/86/44 and independent substring98 are referenced only, not rerun here and not added to independent denominators. Their retained C-byte and diagnostic losses are not waived.', children: pids.map(pid => ({ pid, groupAlive: alive(pid) })) });
console.log(JSON.stringify({ changes36, changes57, changesHost, sourceMismatch, endpointDrift, children: pids.length, uncommittedSourcePaths, compiler: compiler.phases.map(phase => ({ id: phase.id, status: phase.run.status, valid: phase.valid })) }));
