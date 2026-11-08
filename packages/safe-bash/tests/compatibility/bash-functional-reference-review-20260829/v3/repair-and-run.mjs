import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.dirname(new URL(import.meta.url).pathname);
const capture=fs.openSync(root+'/REPAIR.capture.data','wx',0o600);
const log=row=>fs.writeSync(capture,JSON.stringify(row)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 log({event:'START',at:new Date().toISOString(),children:0});
 const original=fs.readFileSync(root+'/review.mjs','utf8');let corrected=original;
 const changes=[
  ['const stored=source.rows.find(',"assert(['source-commit','author-evidence'].includes(pin.role),'ROLE');const authority=pin.role==='source-commit'?source:manifest;const stored=authority.rows.find("],
  ['stored.bytes===pin.bytes',"stored.bytes===pin.bytes&&(parseInt(stored.mode,8)&511)===pin.mode"],
  ["root+'/REVIEW.capture.data'","root+'/REVIEW-r2.capture.data'"],
  ["['review.mjs','CONTROL-PRESEAL.md']","['review-r2.mjs','CONTROL-PRESEAL.md']"],
  ["root+'/RESULT.json'","root+'/RESULT-r2.json'"]
 ];
 for(const [before,after] of changes){if(corrected.split(before).length!==2)throw Error('EXACT_CORRECTION_MATCH');corrected=corrected.replace(before,after);}
 fs.writeFileSync(root+'/review-r2.mjs',corrected,{flag:'wx'});
 fs.writeFileSync(root+'/CORRECTION-SEAL.json',JSON.stringify({originalSha256:hash(Buffer.from(original)),correctedSha256:hash(Buffer.from(corrected)),changes,rolePolicy:['source-commit','author-evidence'],children:0},null,2)+'\n',{flag:'wx'});
 log({event:'SEALED',originalSha256:hash(Buffer.from(original)),correctedSha256:hash(Buffer.from(corrected)),substitutions:changes.length});
 await import('./review-r2.mjs');log({event:'RETURNED',exitCode:process.exitCode??0,children:0});
}catch(error){log({event:'STOP',message:error.message});process.exitCode=1;}finally{fs.closeSync(capture);}
