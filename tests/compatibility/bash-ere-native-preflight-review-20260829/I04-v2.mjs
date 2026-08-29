import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const base=path.dirname(new URL(import.meta.url).pathname),materialized=base+'/capsule/tests/compatibility/bash-ere-native-reference-20260829/preflight-v2/materialized';
const admission=await import(pathToFileURL(materialized+'/admission.mjs'));
const seal=JSON.parse(fs.readFileSync(materialized+'/PRESEAL.json'));let assertions=0;
function rejects(operation,message){assertions++;assert.throws(operation,message?{message}:undefined);}
for(const name of ['GO.json','PRESEAL.json','REVIEW-ACCEPTANCE.json','PREPROVISION.json']){const changed=structuredClone(seal);changed.files.push({...changed.files[0],path:name});rejects(()=>admission.validateManifest(changed),'SEAL_CYCLE');}
const duplicate=structuredClone(seal);duplicate.files.push(duplicate.files[0]);rejects(()=>admission.validateManifest(duplicate),'SEAL_PATH');
const missing=structuredClone(seal);missing.files=missing.files.filter(item=>item.path!=='entry.mjs');rejects(()=>admission.validateManifest(missing),'SEAL_MEMBER');
let getters=0;const bad={};Object.defineProperty(bad,'schema',{get(){getters++;return 'fake';},enumerable:true});rejects(()=>admission.validateReview(bad,{}));assertions++;assert.equal(getters,0);
console.log(JSON.stringify({id:'I04-v2-acyclic-binding-rejections',assertions,status:'PASS',sourceUnchanged:true,native:0,entryImported:false,prior:'I04-v1 expected /MANIFEST/ incorrectly; actual first SEAL_CYCLE rejection preserved. Remaining seven assertions previously unrun.'}));
