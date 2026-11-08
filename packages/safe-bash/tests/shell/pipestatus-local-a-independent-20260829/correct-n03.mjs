import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const [rootArgument] = process.argv.slice(2);
assert(rootArgument && process.argv.length === 3);
const root = fs.realpathSync(rootArgument);
assert(root.endsWith('/tests/shell/pipestatus-local-a-independent-20260829'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(name) { const filename = path.join(root, name), stat = fs.lstatSync(filename); assert(stat.isFile() && stat.size <= 16777216); return fs.readFileSync(filename); }
function save(name, value) { const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); fs.writeFileSync(path.join(root, name), bytes, { flag: 'wx', mode: 0o444 }); return { path: name, bytes: bytes.length, sha256: sha(bytes) }; }
const originalRaw = read('RESULT.json'); assert.equal(sha(originalRaw), '1e74bdc66ac508efc5d6207cd0bb11f90421f1dcdc23a47861de6153f3331605');
const original = JSON.parse(originalRaw), fragmentRaw = read('FRAGMENTS.json'), fragment = JSON.parse(fragmentRaw);
const probe = vm.runInNewContext('(async function(primary, saved, locals, name) { try { throw primary; } ' + fragment.catchText + ' })', {}, { timeout: 1000 });
const observations = [];
for (const primary of [false, 0, null]) { let discardCalls = 0, caught = false, actual; const secondary = { cleanup: 'discard' }; try { await probe.call({ async discardVariable() { discardCalls++; throw secondary; } }, primary, {}, new Map(), 'ordinary'); } catch (error) { caught = true; actual = error; } assert(caught && discardCalls === 1 && actual === secondary); observations.push({ primary, discardCalls, primaryPreserved: actual === primary, secondaryReplacedPrimary: actual === secondary }); }
const correction = save('N03-CORRECTION.json', { id: 'N03', pass: observations.every(row => row.primaryPreserved), kind: 'PURE_EXACT_CATCH_FRAGMENT_WITH_DOUBLES', reviewerCorrection: 'Original isolated catch omitted name, producing ReferenceError before discard; original RESULT.json preserved and original N03 is not product evidence. This invocation supplies the exact missing lexical binding.', fragmentSha256: sha(fragmentRaw), observations, noRuntimeClassesExecuted: true });
const rows = original.rows.map(row => row.id === 'N03' ? { id: 'N03', kind: 'PURE_EXACT_CATCH_FRAGMENT_WITH_DOUBLES', pass: false, correction } : row);
const files = fs.readdirSync(root).filter(name => fs.lstatSync(path.join(root, name)).isFile()).map(name => ({ path: name, bytes: fs.lstatSync(path.join(root, name)).size }));
const retained = files.reduce((sum, row) => sum + row.bytes, 0), capture = files.filter(row => /\.(stdout|stderr|raw)$/.test(row.path)).reduce((sum, row) => sum + row.bytes, 0);
assert(retained + 16777216 <= 134217728 && capture + 16777216 <= 25165824);
const receipt = save('FINAL-RECEIPT.json', { at: new Date().toISOString(), verdict: 'HOLD_SOURCE_PURE', sourceCommit: original.sourceCommit, evidenceCommit: original.evidenceCommit, runtimeSha256: original.sourceHash, originalResult: { path: 'RESULT.json', sha256: sha(originalRaw) }, correction, authorReplay: original.authorReplay, novel: { uniqueGroups: 5, pass: 2, fail: 3, correctedGroup: 'N03', originalN03InvalidReviewerBindingPreserved: true }, rows, compositionUpdateApplied: false, previous323ManifestPreserved: true, noSourceAcceptance: true, minimalFix: 'Enclose all newly acquired saved/operation/hold resources in staged cleanup; attempt all cleanup; preserve raw first reason separately from secondary failures', currentGrant: { pureHelpers: 2, knownRolesIncludingPlannedPublication: 24, maximumKnownRoles: 24, conservativePeak: 3, maximumPeak: 3, retainedLogicalBytes: retained, capturedBytes: capture, publicationReserveBytes: 16777216, workMaximum: 134217728, captureMaximum: 25165824, deadline: '2026-08-29T17:09:16Z' }, qualification: 'Exact SOURCE and isolated PURE fragments only; no whole binding atomicity, real budget exhaustion, runtime restoration or actual cleanup fault reachability proved', product: 0, Workers: 0, compiler: 0, npm: 0, sourceEdits: 0 });
console.log(JSON.stringify({ verdict: 'HOLD', authorReplay: '17 parser + 3 SOURCE = 20/20', novel: '2/5 pass; N01/N02/N03 fail; N03 corrected binding', correction, receipt, rawPrimaryCounterexamples: observations, compositionUpdated: false }));
