import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {candidate,blob,sha,text,save} from './common.mjs';
const provider='tests/fs/webdav/consumer/provider.mts',inventoryPath='tests/plugins/qualified-current-release/inventory.json';
const inventory=JSON.parse(blob(inventoryPath));
const rows=inventory.entries.map(entry=>({path:entry.path,classification:entry.classification,group:entry.group??null,recordedInventorySha256:entry.sha256,selectedGitBlob:text(['rev-parse',`${candidate.candidate}:${entry.path}`]),selectedSourceSha256:sha(blob(entry.path)),hashFieldEnforcedBySelectedChecker:entry.classification!=='current'}));
const mismatches=rows.filter(entry=>entry.recordedInventorySha256!==entry.selectedSourceSha256);
assert.equal(rows.length,192);assert.equal(mismatches.length,1);assert.equal(mismatches[0].path,provider);assert.equal(mismatches[0].classification,'current');
const revisions=['966cfac676f593e2542e4c84d1b79cb49776c08d','e90346e2a6225508f30d77068b26720786ce5cc7','41298e6f46754b3dd419e6433a373aabf2949a50','456a0738b0d2dc130ebbd9b7ccf5e299bcf177da',candidate.base,candidate.candidate];
const lineage=revisions.map(revision=>{const bytes=blob(provider,revision);return{revision,gitBlob:text(['rev-parse',`${revision}:${provider}`]),bytes:bytes.length,sha256:sha(bytes)};});
const checkerPath='tests/plugins/qualified-current-release/inventory-check.mjs',introducedPolicyRevision='02704bd1291b83763d7360b97bc5c6d50403ad10';
const rule='if (entry.classification !== "current") assert.equal(sha256(read(entry.path)), entry.sha256';
const checker=blob(checkerPath).toString();assert.ok(checker.includes(rule));assert.ok(blob(checkerPath,introducedPolicyRevision).toString().includes(rule));
const consumers=blob('tests/plugins/qualified-current-release/consumers.mjs').toString();
assert.ok(consumers.includes('group("webdav-loopback", "tests/fs/webdav/consumer", ["consumer.test.mts", "example.mts", "provider.mts", "types.mts"]'));
assert.ok(consumers.includes('companions: ["tests/fs/webdav/consumer/provider.mts"], nodeTests: 23'));
const report={schema:1,capturedAt:new Date().toISOString(),candidate:candidate.candidate,base:candidate.base,sourceTree:candidate.sourceTree,
 checker:{path:checkerPath,sha256:sha(checker),introducedPolicyRevision,rule:'Current role and route are enforced; entry.sha256 equality is enforced only for non-current entries. Executed current bytes must separately bind the selected Git candidate, not live files.'},
 finding:{originalIndependentStaticExit:1,originalIndependentReceipt:'148d77b2',retained:true,classification:'stale informational hash on maintained current consumer; not a historical classification and not a new waiver',matches:191,total:192,mismatches},
 lineage,rows,
 proposal:{candidateOrFixtureChanges:[],inventoryRewritten:false,driverSourceChanged:false,policy:'Retain original static mismatch. For current-role entries display recorded inventory SHA and selected source SHA/Git blob; require actual selected archive bytes to match the latter. For every non-current entry preserve inventory hash/frozen-evidence checks. Keep all current compilation/runtime routes.',providerRuntimeAuthority:lineage.at(-1),runtimeRoutes:['webdav-loopback strict group, serialized consumer.test.mjs (13 existing cases)','webdav-timestamp-independent companion for23 existing cases (20 controls and3 mutant kills)'],runtimeExecutedByThisInvestigation:false,qualification:'The provider helper changed at456a073. No claim that provider inputs or deployed-server semantics remained unchanged.'},
 evidence:{inventory:{revision:candidate.base,path:inventoryPath,sha256:sha(blob(inventoryPath))},consumers:{revision:candidate.base,path:'tests/plugins/qualified-current-release/consumers.mjs',sha256:sha(consumers)},independentTimestampEvidence:'a30bfd939fc55889c75e357c70ea1cebac3b010c',rootStatement:'timestamp helper fix separately accepted; not rerun in this investigation'}};
const output=mkdtempSync(join(tmpdir(),'unified76-authority-'));save(join(output,'MTS-AUTHORITY.json'),report);console.log(JSON.stringify({output,candidate:report.candidate,finding:report.finding,proposal:report.proposal}));
