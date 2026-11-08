import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { artifact } from './artifacts.mjs';
import { digest,sourceSnapshot } from '../jq-42-independent-review/common.mjs';

const read = name => JSON.parse(readFileSync(new URL(name,import.meta.url)));
const originalTapPath='../jq-42-author-20260827/final-owned.tap';
const originalTap=readFileSync(new URL(originalTapPath,import.meta.url));
const names=[...originalTap.toString().matchAll(/^not ok \d+ - (.*)$/gmu)].map(match=>match[1]);
assert.equal(names.length,22);
const legacyPath='../jq-42-independent-review/legacy-native-proof.json';
const legacyBytes=readFileSync(new URL(legacyPath,import.meta.url));
const legacy=JSON.parse(legacyBytes);
const originalSnapshots=read('canonical-before.json');
const baseline=read('baseline-legacy.json').results.filter(row=>row.route==='direct'&&row.transport==='whole');
const snapshotFor=name=>originalSnapshots.snapshots.find(file=>file.path.endsWith(name));
const select=name=>name.startsWith('strict UTF-8') ? ['independent-increment/safety.test.ts','for (const id of ["raw-lone-continuation"','for (const [id, limit, bytes]']
  :name.startsWith('raw native:') ? ['raw-input.test.ts','for (const fixture of corpus.cases)','\u0000']
  :name.startsWith('strict malformed') ? ['structured-stress/safety.test.ts','for (const [index, input] of malformed.entries())',"test('malformed suffix"]
  :name==='invalid UTF-8 never becomes replacement text' ? ['structured-stress/safety.test.ts',"test('invalid UTF-8 never",'for (const [argv, status]']
  :name.startsWith('malformed UTF-8') ? ['structured/cli.test.ts','test("malformed UTF-8','test("compile errors precede']
  : ['structured/resources.test.ts','test("valid large decimals','test("depth limits'];
const proposal=names.map(name=>{
  const [suffix,startMarker,endMarker]=select(name);
  const snapshot=snapshotFor(suffix);
  assert.ok(snapshot,name);
  assert.equal(digest(readFileSync(snapshot.path)),snapshot.sha256);
  const start=snapshot.text.indexOf(startMarker);
  assert.ok(start>=0,`${name}: start`);
  const end=snapshot.text.indexOf(endMarker,start+startMarker.length);
  const oldAssertion=snapshot.text.slice(start,end<0?undefined:end);
  const probes=legacy.probes.filter(probe=>probe.assertion===name);
  assert.ok(probes.length,name);
  const prior=baseline.filter(row=>probes.some(probe=>probe.id===row.id));
  const mixed=name.startsWith('valid large decimals');
  const regex=name==='invalid UTF-8 never becomes replacement text'||name.startsWith('malformed UTF-8');
  return {
    oldTestPath:snapshot.path,oldTestName:name,oldFileSha256:snapshot.sha256,snapshotArtifact:'canonical-before.json',snapshotHead:originalSnapshots.head,
    oldAssertionStartLine:snapshot.text.slice(0,start).split('\n').length,oldAssertion,
    classification:mixed?'MIXED at accepted baseline: obsolete rejection assertions plus six real acceptance gaps and ten diagnostic gaps; source fix required before TEST-ONLY retirement':regex?'Stale UTF-8 diagnostic regex AND real native parser diagnostic defects at baseline; source fix required, not merely weakening the assertion':'Historical non-native strict-rejection/stop-first-runtime policy; accepted baseline already matches native for this constituent',
    baseline:{probes:prior.length,exact:prior.filter(row=>row.pass).length,diagnosticOnly:prior.filter(row=>!row.pass&&row.differingFields.length===1&&row.differingFields[0]==='stderrHex').length,statusOrStdout:prior.filter(row=>row.differingFields.some(field=>field!=='stderrHex')).length},
    whyStale:mixed?'Native accepts NaN, infinities, leading zero, trailing decimal, leading BOM, and low surrogate replacement; reject-only loop is not a correct oracle. Keep invalid literals, malformed structures, division failures and precision controls as exact native results.':regex?'The bytes are invalid numeric/literal tokens or unfinished strings at their byte/line positions, not a universal UTF-8 rejection diagnostic. Preserve exact completed output and nonzero status, and strengthen stderr to exact native bytes.':'Native replaces malformed UTF-8 or continues after runtime errors, and the immutable old fixture policy overrides deliberately demanded different behavior. Retire only the override, never edit the historical fixture.',
    plannedChange:{applied:false,approval:'REQUIRES DIFFERENT INDEPENDENT LEAF; root schedules separate TEST-ONLY commit after source review',loops:'Preserve every original chunk size, split endpoint, file arrangement, empty chunk, cancellation and effect control; no skips or weakened status/output assertions.',replacementAssertion:suffix.endsWith('independent-increment/safety.test.ts')?'assert.deepEqual(await executeBytes(vector.argv!, source), nativeExpected); apply to baseline AND every original chunk split':suffix.endsWith('structured/cli.test.ts')||suffix.endsWith('structured/resources.test.ts')?'assert.deepEqual({status:result.exitCode,stdoutHex:Buffer.from(result.stdout).toString("hex"),stderrHex:Buffer.from(result.stderr).toString("hex")}, nativeExpected);':'assert.deepEqual({status:result.status,stdoutHex:Buffer.from(result.stdout).toString("hex"),stderrHex:Buffer.from(result.stderr).toString("hex")}, nativeExpected);',expectedLookup:'Use exact argv + inputHex + files and the explicit per-vector expected tuples below. No capture at test runtime; frozen file must have the pinned hash. Preserve original fixtures unchanged. Names may be clarified only with an explicit old-to-new mapping.'},
    nativeProof:probes.map(probe=>({artifact:legacyPath,artifactSha256:digest(legacyBytes),id:probe.id,vectorSha256:digest(JSON.stringify(probe)),argv:probe.argv,inputHex:probe.inputHex,files:probe.files??{},expected:probe.expected,historicalExpected:probe.historicalExpected})),
  };
});
const frozenBytes=readFileSync(new URL('native-frozen.json',import.meta.url));
const frozen=JSON.parse(frozenBytes);
const supplemental=[['strict malformed JSON 5 across chunk boundaries','[01]'],['strict malformed JSON 15 across chunk boundaries','\uFEFF0'],['strict malformed JSON 21 across chunk boundaries','-Infinity'],['strict malformed JSON 22 across chunk boundaries','NaN']].map(([name,input])=>{
  const inputHex=Buffer.from(input).toString('hex');
  const probe=frozen.vectors.find(vector=>vector.inputHex===inputHex&&JSON.stringify(vector.argv)==='["-c","."]');
  assert.ok(probe,name);
  return {oldTestPath:'tests/commands/structured-stress/safety.test.ts',oldTestName:name,oldAssertion:proposal.find(change=>change.oldTestName==='strict malformed JSON 14 across chunk boundaries').oldAssertion,classification:'Newly exposed stale rejection assertion after an actual native acceptance gap is fixed; not part of historical22',replacementAssertion:'Assert exact native expected status/stdout/stderr for this existing input across the unchanged [1,2,5,64] chunk loop; retain all other malformed inputs as exact native failures.',nativeProof:{artifact:'native-frozen.json',artifactSha256:digest(frozenBytes),vectorSha256:digest(JSON.stringify(probe)),...probe},applied:false};
});
artifact('planned-test-only-changes-v2.json',{recordedAt:new Date().toISOString(),source:sourceSnapshot(),originalTapPath,originalTapSha256:digest(originalTap),scope:'PROPOSAL ONLY, canonical files unchanged; not source acceptance, not independent approval; v2 supplies exact whole assertion blocks for the supplemental four, v1 retains their abbreviated assertions',summary:{originalTests:22,alreadyNativePolicyRetirements:19,staleRegexWithRealBaselineDiagnostics:2,mixedComposite:1,supplementalNewlyExposedStaleTests:4},proposal,supplemental});
const rows=proposal.map(change=>`| ${change.oldTestName} | ${change.nativeProof.length} | ${change.baseline.exact}/${change.baseline.probes} | ${change.baseline.diagnosticOnly} | ${change.baseline.statusOrStdout} |`).join('\n');
artifact('PROPOSAL.md',`# Canonical TEST-ONLY proposal — August 27, 2026\n\nNOT APPLIED. Requires another independent leaf's review and a separate root-authorized TEST-ONLY followup. No canonical tests, old fixtures, accepted reports or old results are edited.\n\nThe exact 22-name historical selector remains pinned to final-owned.tap SHA-256 ${digest(originalTap)}. All five original files are preserved byte-for-byte in canonical-before.json with commit and SHA-256 evidence. planned-test-only-changes.json contains each original path/name, exact original assertion block and start line, replacement assertion, per-constituent argv/input/files/expected bytes, and native vector/file hashes. It is an explicit machine-readable unapplied change set, not instructions to weaken every stderr assertion.\n\n## Classification\n\n- 19 tests: first-failure policy retirements already matching native at the accepted baseline.\n- 2 tests: stale generic UTF-8 regex expectations, but with real native diagnostic gaps at baseline; changing only the regex would not have fixed those gaps.\n- 1 resource composite: obsolete rejection assertions AND six actual acceptance gaps plus ten diagnostic gaps at baseline. Preserve its invalid-input, division, precision and surrogate constituents.\n- Four additional rejection tests become red when [01], leading BOM, -Infinity and NaN correctly succeed. These are supplemental to, not replacements for, historical22.\n\nEvery native constituent is frozen before its source correction. The immutable legacy94 stays 94, including the separate five supplementary controls; the historical baseline remains 45 exact / 49 differences, not a rebaselined green result. The author now observes exact results for the whole legacy94, but only independent source review can authorize the proposed test updates.\n\n| Historical test | Constituents | Baseline exact | Diagnostic gaps | Status/stdout gaps |\n| --- | ---: | ---: | ---: | ---: |\n${rows}\n\n## Required followup\n\nKeep every original chunk loop, empty chunk, file input arrangement, split endpoint, status/output check, cancellation guard and effect check. Replace strict policy overrides and generic diagnostic regexes only for the listed vectors with exact frozen native status/stdout/stderr tuples. Never overwrite raw-input-native.json or any historical fixture. Do not force the source back into the retired rejection behavior. Add an explicit old-to-new test name map if names are clarified. The source author does not approve this proposal; no TEST-ONLY commit is made in this phase.\n`,true);
console.log(JSON.stringify({original:proposal.length,supplemental:supplemental.length}));
