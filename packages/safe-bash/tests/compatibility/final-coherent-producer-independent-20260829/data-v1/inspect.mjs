import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo='/Users/kjopek/Workspace/safe-bash',relative='tests/compatibility/final-coherent-producer-20260829',root=path.join(repo,relative),own=path.dirname(fileURLToPath(import.meta.url));
const commit='937f1d9317256c18066d9f74c0ae0bb21842bfaa';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const git=spawnSync('/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false','ls-tree','-rz',commit,'--',relative],{cwd:repo,maxBuffer:2097152,timeout:10000});fs.writeFileSync(path.join(own,'inventory.stdout'),git.stdout,{flag:'wx'});fs.writeFileSync(path.join(own,'inventory.stderr'),git.stderr,{flag:'wx'});assert.equal(git.status,0);assert.equal(git.signal,null);
const summaries=[],pins=[];
function brief(value,depth=0){if(value===null||typeof value!=='object')return typeof value==='string'&&value.length>500?value.slice(0,500)+'…':value;if(Array.isArray(value))return {arrayLength:value.length,sample:value.slice(0,2).map(row=>brief(row,depth+1))};if(depth>3)return {keys:Object.keys(value)};return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,brief(item,depth+1)]));}
for(const record of git.stdout.toString().split('\0').filter(Boolean)){const parsed=/^(\d+) blob ([0-9a-f]{40})\t(.+)$/.exec(record);assert(parsed);const filename=path.join(repo,parsed[3]);if(path.dirname(filename)!==root)continue;assert(!filename.endsWith('/AGENTS.md'));const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<16777216);const bytes=fs.readFileSync(filename);assert.equal(bytes.length,stat.size);assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),parsed[2]);pins.push({path:filename,bytes:bytes.length,sha256:sha(bytes),blob:parsed[2]});if(filename.endsWith('.json'))summaries.push({file:path.basename(filename),...brief(JSON.parse(bytes))});}
fs.writeFileSync(path.join(own,'INSPECTION.json'),JSON.stringify({commit,pins},null,2)+'\n',{flag:'wx'});fs.writeFileSync(path.join(own,'SUMMARY.json'),JSON.stringify(summaries,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({files:pins.map(row=>({path:path.basename(row.path),bytes:row.bytes,sha256:row.sha256})),summaryPath:path.join(own,'SUMMARY.json')},null,2));
