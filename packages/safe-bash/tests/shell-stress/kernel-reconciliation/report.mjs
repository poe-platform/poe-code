import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { platform, release, version, arch } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { nativeCases } from '../expanded-gaps/cases.mjs';
import { cases } from '../invocation-modes/cases.ts';
import { save, sha256, owned, sourceStamp, alive } from './support.mjs';

const current = JSON.parse(await readFile(`${owned}/baseline-recovered.json`));
const native36 = JSON.parse(await readFile(`${owned}/native36-current.json`));
const native57 = JSON.parse(await readFile(`${owned}/native57-current.json`));
const prior36 = JSON.parse(await readFile('tests/shell-stress/expanded-gaps/ready-0f5dbb3.json'));
const prior57 = JSON.parse(await readFile('tests/shell-stress/expanded-gaps/ready-original57-comparison.json'));
const labels = {
  'header-noexecute': 'Historical-only diagnostic dialect; primary exact, same refusal and effects.',
  'header-execute-no-read': 'Diagnostic context only; both refuse126 before effects. Not a new execution capability defect.',
  'env-single-kernel-argument': 'Real optional-interpreter-argument capability gap under the explicit virtual allowlist; Darwin-specific successful native launch, not universal Linux semantics.',
  'env-injection-text': 'Observable127-versus126 error/status boundary under interpreter allowlist. Native treats semicolon literally; neither implementation injects a command or executes the body.',
  'env-missing-target': 'Observable127-versus126 missing-target/unsupported-interpreter policy distinction. Not an environment leak or successful-command regression.',
  'env-unsupported-interpreter': 'Unsupported interpreter policy and diagnostic wording; status126 and no effects agree.',
  'parameter-substitution-order': 'Filesystem creation profile only: marker0666 virtual versus0644 native. Exact expansion, sequencing, bytes and status agree.',
  'parameter-existing-controls': 'Functional missing scalar substring expansion. Both native profiles execute the unchanged valid input; virtual parser rejects it before output. No new-regression claim.',
  'stdin-eof-syntax-prior-effects': 'Historical-only syntax diagnostic dialect; primary exact. Earlier stdout and file effect preserved in all three.',
  'child-environment-isolation': 'Historical-only command-not-found line prefix; primary exact. Parent locals/exports and child function isolation agree.',
  'path-only-denied-126': 'Original harness source-name/line offset plus historical dialect: native outer+one-line role prelude versus virtual shell+original source. Status/effects agree.',
  'path-missing-127': 'Original harness source-name/line offset plus historical dialect; correct127 and no effects, not a missing-command dispatch defect.',
  'path-unsupported-shebang-policy': 'Explicit interpreter allowlist and diagnostic/source-name difference;126 and no effects agree. No authorization to execute ambient host interpreters.',
  'path-binary-policy': 'Deliberate no-native-binary execution;126/no effects agree. Remaining raw difference is diagnostic wording/source/profile.',
  'path-invalid-utf8-policy': 'Explicit UTF-8 source policy: reject126 before parsing versus native byte-source command lookup127. Real raw status/diagnostic loss, not a required host-binary capability.',
};
const effects = {};
const effectKey = entries => {
  const hash = sha256(JSON.stringify(entries));
  effects[hash] = entries;
  return hash;
};
const tuple36 = row => ({ status: row.status, stdoutHex: Buffer.from(row.stdout, 'base64').toString('hex'), stderrHex: Buffer.from(row.stderr, 'base64').toString('hex'), effects: effectKey(row.entries) });
const tuple57 = row => ({ ...row, effects: effectKey(row.effects) });
const rows = [
  ...current.product36.filter(row => row.profiles.some(profile => !profile.passed)).map(row => ({ cohort: 'expanded36', id: row.id, fixture: nativeCases.find(fixture => fixture.id === row.id), actual: tuple36(row.actual), profiles: native36.profiles.map(profile => ({ role: profile.role, tuple: tuple36(profile.rows.find(native => native.id === row.id).tuple), passed: row.profiles.find(candidate => candidate.role === profile.role).passed })), classification: labels[row.id] })),
  ...current.comparison57.filter(row => row.profiles.some(profile => !profile.passed)).map(row => ({ cohort: 'invocation57', id: row.id, fixture: cases.find(fixture => fixture.id === row.id), actual: tuple57(row.actual), profiles: row.profiles.map(profile => ({ role: profile.role, tuple: tuple57(profile.expected), passed: profile.passed })), classification: labels[row.id] })),
];
assert.equal(rows.length, 15);
assert.ok(rows.every(row => row.classification));
save('unresolved-rows.json', { encoding: 'Exact bytes as hexadecimal; effect maps content-addressed below. Profiles always primary then historical. Fixture sources/bytes unchanged.', rows, effects });
save('functional-handoff.json', {
  sourceAnchor: current.final,
  fixCandidate: rows.find(row => row.id === 'parameter-existing-controls'),
  profileDecisionCandidates: rows.filter(row => ['env-single-kernel-argument', 'env-injection-text', 'env-missing-target'].includes(row.id)),
  expectations: 'These are exact existing frozen cases, not new unmeasured simplified tests or relaxed expectations. All listed losses remain red. ROOT alone authorizes scope and source changes.',
  productRepro: 'node --import tsx tests/shell-stress/expanded-gaps/product.mjs parameter-existing-controls',
  sourceReview: { parser: 'src/shell/parser.ts:435-455: supported operator list omits substring colon/offset/length.', interpreter: 'src/shell/runtime.ts:1106-1112: only exact /usr/bin/env bash|sh binds a virtual interpreter; other env text rejects126.' },
});
function escaped(hex) {
  let result = '"';
  for (const byte of Buffer.from(hex, 'hex')) {
    if (byte === 10) result += '\\n';
    else if (byte === 13) result += '\\r';
    else if (byte === 9) result += '\\t';
    else if (byte === 34 || byte === 92) result += '\\' + String.fromCharCode(byte);
    else if (byte >= 32 && byte <= 126) result += String.fromCharCode(byte);
    else result += '\\x' + byte.toString(16).padStart(2, '0');
  }
  return result + '"';
}
const effectNames = Object.fromEntries(Object.keys(effects).map((hash, index) => [hash, `E${index}`]));
const display = tuple => `(${tuple.status}, ${escaped(tuple.stdoutHex)}, ${escaped(tuple.stderrHex)}, ${effectNames[tuple.effects]})`;
let table = '# Exact current unresolved tuples\n\nEach tuple is `(status, stdout bytes, stderr bytes, effects ID)`. ASCII is literal; `\\n`, `\\t`, `\\r`, `\\\\`, `\\"`, and `\\xHH` encode exact bytes. No replacement-character decoding or normalization. E IDs identify exact complete effect maps in `unresolved-rows.json`; their digest mapping is below. Both profiles are whole-cohort, never selected per row. Primary-exact/historical-only losses are retained.\n\n| Cohort / row | Current | GNU5.3 primary | Bash3.2 historical | Classification |\n| --- | --- | --- | --- | --- |\n';
for (const row of rows) table += `| ${row.cohort}: ${row.id} | \`${display(row.actual).replaceAll('|', '&#124;')}\` | \`${display(row.profiles[0].tuple).replaceAll('|', '&#124;')}\` | \`${display(row.profiles[1].tuple).replaceAll('|', '&#124;')}\` | ${row.classification} |\n`;
table += '\n## Exact effects lookup\n\nFull entry maps include unchanged fixture bytes and modes, not merely newly created files. Native role symlinks are fixture infrastructure and excluded by the original36 harness. Invocation57 tracks its original `effect` and `fd-output` files only; no broader namespace assertion is invented.\n\n';
for (const [hash, name] of Object.entries(effectNames)) table += `- ${name}: \`${hash}\` = \`${JSON.stringify(effects[hash])}\`\n`;
save('RAW_ROWS.md', table);
const history = {
  expanded36Changed: current.product36.filter(row => !isDeepStrictEqual(row.actual, prior36.rows.find(prior => prior.id === row.id).actual)).map(row => row.id),
  prior57ProfileKeys: prior57.profiles.map(profile => ({ profile: profile.profile, total: profile.rows.length, passed: profile.rows.filter(row => row.passed).length })),
};
const final = await sourceStamp();
assert.equal(final.valid, true);
const fileHashes = {};
for (const name of (await readdir(owned)).sort()) fileHashes[`${owned}/${name}`] = sha256(await readFile(`${owned}/${name}`));
const originalHashes = {};
for (const path of ['tests/shell-stress/expanded-gaps/cases.mjs', 'tests/shell-stress/expanded-gaps/product.mjs', 'tests/shell-stress/expanded-gaps/native-frozen.json', 'tests/shell-stress/expanded-gaps/ready-0f5dbb3.json', 'tests/shell-stress/expanded-gaps/ready-original57-comparison.json', 'tests/shell-stress/invocation-modes/cases.ts', 'tests/shell-stress/invocation-modes/holdout.test.ts', 'tests/shell-stress/invocation-modes/native-corrected-evidence.json', '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/bash-5.3/doc/bashref.texi']) originalHashes[path] = sha256(await readFile(path));
save('audit.json', { timestamp: new Date().toISOString(), final, summary: current.summary, history, host: { platform: platform(), release: release(), version: version(), arch: arch(), node: process.version, umask: process.umask().toString(8) }, originalHashes, fileHashes, phaseGuards: current.phases.map(phase => ({ id: phase.id, valid: phase.valid, loaded: phase.loaded, sourceImports: Object.keys(current.manifests[phase.loaded]).filter(path => path.startsWith('src/')).length, drift: phase.drift, importedDrift: phase.importedDrift })), children: current.children.map(child => ({ ...child, finalGroupAlive: alive(child.pid) })) });
console.log(JSON.stringify({ unresolved: rows.length, history, children: current.children.length, sourceValid: final.valid }));
