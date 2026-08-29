import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url));
const author='/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-ere-core-public-pilot-preparation-20260829/runtime-author-v1';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(name,maximum=2097152){const filename=path.join(author,name);const stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);const bytes=fs.readFileSync(filename);assert.equal(bytes.length,stat.size);return bytes;}
const profileBytes=read('PROFILE.json');assert.equal(profileBytes.length,1285464);assert.equal(hash(profileBytes),'446f44cea9091ce59a12c5591bc1d6e91049003848bef33bd75f520c98728aa6');
const profile=JSON.parse(profileBytes);
const sources={};for(const name of ['core.mjs','data.mjs','observer.mjs','process-owner.mjs','coordinator.mjs','cell.mjs','controls.mjs','prepare.mjs']){const bytes=read(name,32768);sources[name]={bytes:bytes.length,sha256:hash(bytes),text:bytes.toString()};}
const record={utc:new Date().toISOString(),pid:process.pid,profileSha256:hash(profileBytes),profileKeys:Object.keys(profile),node:profile.node,archive:profile.archive,assets:profile.assets,layouts:profile.layouts.map(row=>({...row,shipping:row.shipping.length})),cells:profile.cells.map(row=>({id:row.id,layout:row.layout,definition:row.definition,limits:row.inheritedLimits})),sources:Object.fromEntries(Object.entries(sources).map(([name,row])=>[name,{bytes:row.bytes,sha256:row.sha256}]))};
fs.writeFileSync(own+'/INSPECTION.json',JSON.stringify(record,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(own+'/SOURCE-READ.txt',Object.entries(sources).map(([name,row])=>'FILE '+name+'\n'+row.text).join('\n'),{flag:'wx'});
console.log(JSON.stringify({...record,assets:profile.assets?.length,cells:profile.cells.map(row=>row.id)},null,2));
console.log('CORE TAIL\n'+sources['core.mjs'].text.slice(sources['core.mjs'].text.indexOf('export async function schedule')));
console.log('PROCESS OWNER\n'+sources['process-owner.mjs'].text);
console.log('COORDINATOR\n'+sources['coordinator.mjs'].text);
