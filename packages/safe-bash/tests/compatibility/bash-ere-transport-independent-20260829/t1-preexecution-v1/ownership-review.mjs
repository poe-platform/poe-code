import fs from 'node:fs';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const base=import.meta.dirname;
const sealBytes=fs.readFileSync(base+'/OWNERSHIP-PRESEAL.json');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(sealBytes),process.argv[2]);
const seal=JSON.parse(sealBytes);
assert.ok(Date.now()<Date.parse(seal.deadline));
for(const row of seal.files){const stat=fs.lstatSync(base+'/'+row.path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===row.bytes);assert.equal(sha(fs.readFileSync(base+'/'+row.path)),row.sha256);}
const actual=cp.spawn;
const records=[];
cp.spawn=function(command,args,options){
  assert.equal(command,seal.node);
  assert.equal(args[0],base+'/run/preparation-r2/stub.mjs');
  assert.equal(args.length,2);
  assert.equal(args[1],records.length===0?'normal':'held');
  assert.ok(records.length<2);
  assert.equal(options.cwd,base+'/run/preparation-r2/');
  assert.deepEqual(Object.keys(options.env).sort(),['HOME','LANG','LC_ALL','PATH','TMPDIR']);
  const row={role:args[1],started:new Date().toISOString(),exit:{present:false},close:{present:false},error:{present:false}};
  records.push(row);
  const child=actual.call(cp,command,args,options);
  row.pid=child.pid;
  child.once('exit',(code,signal)=>{row.exit={present:true,code,signal};});
  child.once('close',(code,signal)=>{row.close={present:true,code,signal};row.ended=new Date().toISOString();});
  child.once('error',reason=>{row.error={present:true,kind:typeof reason};});
  return child;
};
syncBuiltinESMExports();
process.argv[2]=seal.ownerSeal;
let failure={present:false};
try{await import(pathToFileURL(base+'/run/preparation-r2/owner-controls.mjs'));}catch(reason){failure={present:true,kind:typeof reason,message:reason instanceof Error?reason.message:null};process.exitCode=1;}
finally{cp.spawn=actual;syncBuiltinESMExports();fs.writeFileSync(base+'/OWNERSHIP-RESULT.json',JSON.stringify({records,failure,instrumentation:'Reviewer adds exit/close observers and fixed spawn admission; author controller/helpers/fixtures unchanged.'},null,2)+'\n',{flag:'wx'});}
assert.equal(records.length,2);
assert.ok(records.every(row=>row.exit.present&&row.close.present&&!row.error.present));
assert.equal(failure.present,false);
