import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const own=new URL('.',import.meta.url),preseal=JSON.parse(fs.readFileSync(new URL('PRESEAL.json',own)));
for(const row of preseal.files){const filename=new URL(row.path,own),stat=fs.lstatSync(filename);assert(stat.isFile()&&stat.size===row.bytes&&stat.size<=1048576);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),row.sha256);}
const {Owner,identity}=await import('./snapshot/admin-owner-r1/tracked-owner.mjs');
const {controls}=await import('./snapshot/admin-owner-r2/controls.mjs');
const node='/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node',raw=fileURLToPath(new URL('harmless/',own));
fs.mkdirSync(raw);
const owner=new Owner({raw,cwd:raw,env:{PATH:'',HOME:raw,LC_ALL:'C',LANG:'C',TZ:'UTC'},tools:[identity(node,134217728)],wallMs:20000,reserveMs:2000,cleanupMs:2000,maxStarts:3,peak:2,captureLimit:1048576,metadataLimit:1048576,tailBytes:65536});
const result=await controls(owner,node,fileURLToPath(new URL('snapshot/admin-owner-r2/',own)));
const snapshot=owner.snapshot();assert.equal(result.length,10);assert.equal(snapshot.activeKnownPIDs.length,0);assert.equal(snapshot.knownStarts,3);assert(snapshot.starts.every(row=>row.exitObserved&&row.closeObserved&&row.stdoutEnd&&row.stderrEnd));
fs.writeFileSync(new URL('AUTHOR-RESULT.json',own),JSON.stringify({result,snapshot,pureGroups:8,harmlessChildren:2,productCalls:0},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({pure:8,harmless:2,pids:snapshot.starts.map(row=>row.pid),knownOutstanding:0,productCalls:0}));
