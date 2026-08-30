import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { discoveryFixCases, discoveryFixFiles, discoveryFixFileText } from '../../shell/invocation-discovery-fixes-cases.ts';
import { differentialCases, syntaxCases } from '../cases.ts';
import { additionalCases } from '../current-gaps/cases.ts';
import { cases as closureCases } from '../invocation-closure/cases.ts';
import { root, save, sha256 } from './support.mjs';

const paths = ['tests/shell/invocation-discovery-fixes.test.ts', 'tests/shell/invocation-discovery-fixes-cases.ts', 'tests/shell/invocation-discovery-fixes-native.ts', 'tests/shell/invocation-discovery-fixes-native.json', 'tests/shell-stress/differential.test.ts', 'tests/shell-stress/cases.ts', 'tests/shell-stress/helpers.ts', 'tests/shell-stress/model.ts', 'tests/shell-stress/virtual-child.ts', 'tests/shell-stress/probes.ts', 'tests/shell-stress/process.ts', 'tests/shell-stress/current-gaps/compatibility.test.ts', 'tests/shell-stress/current-gaps/cases.ts', 'tests/shell-stress/current-gaps/reference.ts', 'tests/shell-stress/invocation-closure/holdout.test.ts', 'tests/shell-stress/invocation-closure/cases.ts', 'tests/shell-stress/invocation-closure/probe.ts', 'tests/shell-stress/invocation-closure/support.ts', 'tests/shell-stress/invocation-closure/native-preparation.json', 'tests/integration/full-gate-20260827/REPORT.md', 'tests/integration/full-gate-20260827/evidence/classification.json'];
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const inputs = {};
for (const path of paths) {
  const bytes = await readFile(resolve(root, path));
  const blob = git('rev-parse', `HEAD:${path}`).toString().trim();
  assert.equal(sha256(git('cat-file', 'blob', blob)), sha256(bytes), `Original input already differs from committed HEAD: ${path}`);
  inputs[path] = { blob, sha256: sha256(bytes) };
}
const classification = JSON.parse(await readFile(resolve(root, paths.at(-1))));
const routed = classification.failures.filter(row => ['historical-bash32-profile', 'registered-command-label', 'bash-native-profile'].includes(row.classification));
assert.equal(routed.length, 27);
const rows = [];
for (const role of ['bash', 'sh']) for (const specimen of discoveryFixCases) rows.push({ id: `discovery/${role}/${specimen.name}`, name: specimen.name, cohort: 'discovery', role, commandName: 'shell', source: specimen.source, stdinHex: '', files: [...discoveryFixFiles.map(path => ({ path, text: discoveryFixFileText, mode: 0o755 })), { path: 'tools/linktool', link: 'closuretool' }] });
for (const [cohort, specimens] of [['differential', differentialCases], ['syntax', syntaxCases], ['gaps', additionalCases]]) for (const specimen of specimens) rows.push({ id: `${cohort}/${specimen.name}`, name: specimen.name, cohort, role: 'bash', commandName: 'shell-stress', source: specimen.script, stdinHex: Buffer.from(specimen.stdin ?? '').toString('hex'), env: specimen.env ?? {}, limits: specimen.limits ?? {}, files: Object.entries(specimen.initialFiles ?? {}).map(([path, text]) => ({ path, text, mode: 0o644 })) });
for (const specimen of closureCases) rows.push({ id: `closure/${specimen.id}`, name: specimen.id, cohort: 'closure', role: specimen.role ?? 'bash', commandName: specimen.role ?? 'bash', source: specimen.source, entry: specimen.entry ?? 'c', locale: specimen.locale ?? 'C', chunkBytes: specimen.chunkBytes, originalDiagnosticFragments: specimen.diagnostic ?? [], stdinHex: specimen.stdinHex ?? Buffer.from(specimen.stdin ?? '').toString('hex'), files: (specimen.fixtures ?? []).map(fixture => ({ path: fixture.path, ...(fixture.body === undefined ? {} : { text: fixture.body }), ...(fixture.hex === undefined ? {} : { hex: fixture.hex }), ...(fixture.link === undefined ? {} : { link: fixture.link }), ...(fixture.directory ? { directory: true } : {}), mode: fixture.mode ?? 0o644 })) });
rows.push(
  { id: 'control/name-line', name: 'name-line', cohort: 'control', role: 'bash', commandName: 'profile-review', source: 'printf "name=%s\\n" "$0"; :\ncommand -z true', stdinHex: '', files: [] },
  { id: 'control/exact-tuple', name: 'exact-tuple', cohort: 'control', role: 'bash', commandName: 'profile-review', source: 'printf "first\\000last\\n"; printf "error\\n" >&2; printf kept >result; false', stdinHex: '', files: [{ path: 'result', text: '', mode: 0o644 }] },
  { id: 'control/registry-truth', name: 'registry-truth', cohort: 'control', role: 'bash', commandName: 'profile-review', source: 'PATH=; command -V true printf; type -t true printf', stdinHex: '', files: [] },
);
assert.equal(rows.length, 169);
const originals = { discovery: JSON.parse(await readFile(resolve(root, 'tests/shell/invocation-discovery-fixes-native.json'))), closure: JSON.parse(await readFile(resolve(root, 'tests/shell-stress/invocation-closure/native-preparation.json'))) };
save('original-oracles.json', originals);
save('inputs.json', { capturedAt: new Date().toISOString(), head: git('rev-parse', 'HEAD').toString().trim(), routingCommit: '51282a9', sourceCommit: '6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a', inputs, routed: routed.map(({ name, path, originalSourceLine, classification, observed }) => ({ name, path, originalSourceLine, classification, originalObserved: observed })), counts: { routedTotal: 27, historicalProfile: 25, classification: 2, discovery: 52, differential: 72, syntax: 5, gaps: 11, closure: 26, controls: 3 }, rows, reviewPolicy: { nativeProfiles: 'Whole identical case roster for both pinned binaries, preserving original declared UTF-8 overrides.', originalDiagnostics: 'Keep all original strict tuples and their profile/invocation identity; canonical invocation identity is explicit, never stderr rewriting.', extraModeEvidence: 'Existing assertions omit file modes. New raw records retain modes without silently widening/narrowing those historical assertions.', classification: 'Native builtin and actual virtual registered command remain different roles. Safe-plugin assertions are separate from strict native comparisons.', outsideScope: 'No five custom-first-read requirements, OLD9 profile, kernel replay, author proposal, source edit or full-gate run.' } });
console.log(JSON.stringify({ routed: 27, historical: 25, classification: 2, rows: rows.length }));
