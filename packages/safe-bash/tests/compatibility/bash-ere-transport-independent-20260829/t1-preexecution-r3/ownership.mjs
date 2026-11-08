import fs from 'node:fs';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const own=import.meta.dirname,sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sealBytes=fs.readFileSync(own+'/PRESEAL.json');assert.equal(sha(sealBytes),process.argv[2]);const seal=JSON.parse(sealBytes);assert.ok(Date.now()<Date.parse(seal.deadline));
for(const file of seal.files){assert.equal(sha(fs.readFileSync(own+'/'+file.path)),file.sha256);}
const inputs=JSON.parse(fs.readFileSync(own+'/INPUTS.json'));
const ownerRow=inputs.find(row=>row.path.endsWith('/OWNER-PRESEAL-v2.json'));const ownerBytes=Buffer.from(ownerRow.base64,'base64');assert.equal(sha(ownerBytes),ownerRow.sha256);
const r3=own+'/run/preparation-r3';assert.equal(sha(fs.readFileSync(r3+'/OWNER-PRESEAL-v2.json')),ownerRow.sha256);
const config=JSON.parse(ownerBytes);const records=[];const actualSpawn=cp.spawn;
cp.spawn=function(command,args,options){assert.equal(command,config.node);assert.deepEqual(args,[r3+'/stub.mjs','held']);assert.equal(options.cwd,r3+'/');assert.ok(records.length<3);const record={role:['clock-false','publication-undefined','timeout'][records.length],started:new Date().toISOString(),exit:{present:false},close:{present:false},error:{present:false}};records.push(record);const child=actualSpawn.call(cp,command,args,options);record.pid=child.pid;child.once('exit',(code,signal)=>record.exit={present:true,code,signal});child.once('close',(code,signal)=>{record.close={present:true,code,signal};record.ended=new Date().toISOString();});child.once('error',reason=>record.error={present:true,kind:typeof reason});return child;};
syncBuiltinESMExports();process.argv[2]=ownerRow.sha256;let failure={present:false};
try{await import(pathToFileURL(r3+'/owner-controls-v2.mjs'));}catch(reason){failure={present:true,kind:typeof reason,message:reason instanceof Error?reason.message:null};process.exitCode=1;}
finally{cp.spawn=actualSpawn;syncBuiltinESMExports();fs.writeFileSync(own+'/OWNERSHIP.json',JSON.stringify({records,failure,normalReexecuted:false,instrumentation:'Fixed spawn admission and independent exit/close observers; author controller unchanged.'},null,2)+'\n',{flag:'wx'});}
assert.equal(failure.present,false);assert.equal(records.length,3);assert.ok(records.every(row=>row.exit.present&&row.close.present&&!row.error.present));
