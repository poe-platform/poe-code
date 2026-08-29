import fs from 'node:fs';
import path from 'node:path';
import { ownedWriter } from './owned-writer.mjs';
import { bytes, hash, requireValue } from './common.mjs';
import { mutationInitial, mutateOwned, mutationMatches, mutationExpected } from './mutation.mjs';

export const writerVariants = [
  ['enrolled','',false,'INJECTED_enrolled'],['open-before','',false,'INJECTED_open-before'],['opened','',true,'INJECTED_opened'],
  ['write-short','DATA',true,null],['write-zero','',true,'WRITER_SHORT_WRITE'],['write-after','D',true,'INJECTED_write-after'],
  ['deferred-before','DATA',true,'INJECTED_deferred-before'],['deferred-after','DATA',true,'INJECTED_deferred-after'],['close-after','DATA',true,'INJECTED_close-after'],
  ['write-zero-close-after','',true,'WRITER_SHORT_WRITE'],['cap','',false,'WRITER_PATH_OR_BOUND'],['publication-undefined','',true,'undefined'],
];
export function writerControls(directory) {
  const results = [], artifacts = [];
  for (const [index,[fault,expected,exists,code]] of writerVariants.entries()) {
    const filename = path.join(directory,'writer-control-'+String(index).padStart(2,'0')+'.data');
    let published = 0, caught, present = false;
    const owner = ownedWriter({root:directory,entries:[{path:filename,kind:'create',mode:0o600,maximum:4}],role:'HARMLESS_FIXTURE',fault:['cap','publication-undefined'].includes(fault)?'none':fault,onEvent:event=>{if(event.stage==='opened')published++;if(fault==='publication-undefined'&&event.stage==='opened')throw undefined;}});
    try { owner.write(filename,Buffer.from(fault==='cap'?'DATAX':'DATA')); } catch (error) {present=true;caught=error;} finally {owner.close();}
    const receipt=owner.receipt(),row=receipt.rows[0];
    requireValue(receipt.closed&&receipt.retired&&row.enrolled&&row.closed&&row.stages[0]==='enrolled','WRITER_OWNERSHIP_CLOSURE');
    requireValue(present===(code!==null)&&(!present||(code==='undefined'?caught===undefined:caught?.code===code)),'WRITER_DESIGNATED_FAULT');
    requireValue(published===(exists?1:0),'WRITER_ENROLLED_BEFORE_ACQUISITION');
    if(fault==='write-zero-close-after')requireValue(row.primary.code==='WRITER_SHORT_WRITE'&&row.cleanup.some(value=>value.code==='INJECTED_close-after'),'WRITER_PRIMARY_AND_CLEANUP');
    if(exists){const expectedBuffer=Buffer.from(expected);bytes(filename,4,{bytes:expectedBuffer.length,mode:0o600,sha256:hash(expectedBuffer)});artifacts.push({name:path.basename(filename),bytes:expectedBuffer.length,mode:0o600,sha256:hash(expectedBuffer)});}
    results.push({fault,pass:true,caughtPresent:present,receipt});
  }
  const original='original\n', replacement='changed\n';
  for(const [index,fault]of ['none','write-after','open-before'].entries()){
    const filename=path.join(directory,'mutation-control-'+index+'.data');
    const initializer=ownedWriter({root:directory,entries:[{path:filename,kind:'create',mode:0o644,maximum:64}]});
    try{initializer.write(filename,Buffer.from(original));}finally{initializer.close();}
    const owner=ownedWriter({root:directory,entries:[{path:filename,kind:'replace',mode:0o644,maximum:64}],role:'HARMLESS_FIXTURE',fault});
    const status=mutationInitial();let caught=false;
    try{mutateOwned(owner,filename,original,replacement,status);}catch{caught=true;}finally{owner.close();}
    requireValue(caught===(fault!=='none')&&owner.receipt().closed,'MUTATOR_FAULT_CLOSURE');
    const actual=bytes(filename,64);mutationMatches(status,original,replacement,actual,0o644);
    artifacts.push({name:path.basename(filename),bytes:actual.length,mode:0o644,sha256:hash(actual)});
    results.push({fault:'mutation-'+fault,pass:true,status,receipt:owner.receipt()});
  }
  let targetWriteDenied=false;
  try{fs.writeFileSync(path.join(directory,'forbidden-target-write.data'),'forbidden');}catch(error){targetWriteDenied=error.code==='OFFLINE_DENIED';}
  requireValue(targetWriteDenied,'EXTERNAL_FS_GUARD_UNCHANGED');
  return {results,artifacts,targetWriteDenied};
}
export function mutationControls() {
  const original='original\n',replacement='changed\n',base=mutationInitial(),results=[];
  const cases=[
    ['not-entered-original',base,original,true],['not-entered-foreign',base,replacement,false],
    ['entered-original',{...base,state:'ENTERED'},original,true],['entered-foreign',{...base,state:'ENTERED'},replacement,false],
    ['truncated',{...base,state:'TRUNCATED'},'',true],['partial',{...base,state:'WRITING',bytesWritten:1},replacement.slice(0,1),true],
    ['partial-wrong',{...base,state:'WRITING',bytesWritten:1},original.slice(0,1),false],
    ['committed',{...base,state:'COMMITTED',bytesWritten:Buffer.byteLength(replacement)},replacement,true],
    ['unknown',{...base,state:'UNKNOWN'},original,false],['unentered-count',{...base,bytesWritten:1},original,false],
    ['committed-failure',{...base,state:'COMMITTED',bytesWritten:Buffer.byteLength(replacement),primaryPresent:true,primary:'failure'},replacement,false],
  ];
  for(const [id,status,actual,expected]of cases){let passed=false;try{passed=mutationMatches(status,original,replacement,Buffer.from(actual),0o644);}catch{}requireValue(passed===expected,'MUTATION_DESIGNATED_'+id);results.push({id,expected,pass:true});}
  let modeRejected=false;try{mutationMatches(base,original,replacement,Buffer.from(original),0o600);}catch{modeRejected=true;}requireValue(modeRejected,'MUTATION_MODE_REFUSAL');
  return {results,modeRejected,notEnteredExpectedHash:hash(mutationExpected(base,original,replacement))};
}
