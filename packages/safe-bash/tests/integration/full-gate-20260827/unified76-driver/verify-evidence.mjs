import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {directory,sha,candidate,verifyAssembly} from './common.mjs';
import {readProfile} from './profile.mjs';
import {verifyDriverSeal} from './admission.mjs';
const summary=JSON.parse(readFileSync(join(directory,'AUTHOR-EVIDENCE.json'))),index=JSON.parse(readFileSync(join(directory,'RAW-INDEX.json'))),encoded=readFileSync(join(directory,'RAW.json.gz.base64'));
assert.equal(summary.candidate,candidate.candidate);assert.equal(summary.fullGateLaunched,false);assert.equal(sha(encoded),summary.raw.encodedSha256);
const bytes=gunzipSync(Buffer.from(encoded.toString().trim(),'base64'));assert.equal(sha(bytes),summary.raw.payloadSha256);const raw=JSON.parse(bytes);
assert.deepEqual(Object.keys(raw).sort(),Object.keys(index).sort());assert.equal(Object.keys(raw).length,summary.raw.artifacts);
for(const[name,entry]of Object.entries(raw)){const value=Buffer.from(entry.base64,'base64');assert.equal(value.length,entry.bytes);assert.equal(sha(value),entry.sha256);assert.equal(entry.sha256,index[name].sha256);}
verifyAssembly();assert.equal(sha(JSON.stringify(readProfile())),summary.profileSha256);assert.equal(sha(JSON.stringify(verifyDriverSeal())),summary.driverSha256);
assert.equal(sha(readFileSync(join(directory,'CLEANUP.json'))),summary.cleanupSha256);
assert.equal(summary.fixture.originalTotal.pass,58);assert.equal(summary.fixture.originalTotal.fail,10);assert.equal(summary.fixture.revisedTotal.pass,67);assert.equal(summary.fixture.revisedTotal.fail,1);
for(const[label,key]of [['controls-final','controls'],['inventory-final','inventory'],['package-v2/REPORT.json','packageControls']]){const result=JSON.parse(Buffer.from(raw[label].base64,'base64'));assert.equal(result.rows.filter(row=>row.status==='PASS').length,summary[key].pass);assert.equal(result.rows.filter(row=>row.status==='FAIL').length,summary[key].fail);}
console.log(JSON.stringify({candidate:summary.candidate,artifacts:summary.raw.artifacts,fixture:summary.fixture.revisedTotal,controls:summary.controls,inventory:summary.inventory,packageControls:summary.packageControls,fullGateLaunched:false}));
