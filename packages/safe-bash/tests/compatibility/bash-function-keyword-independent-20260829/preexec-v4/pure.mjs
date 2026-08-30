import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {authorRows} from './author-pure.mjs';
import {Primary,errorRecord} from './frozen/auth.mjs';
import {openCapturePair} from './frozen/direct-child.mjs';
const rows=[];
const cases=[...['undefined','null','false','zero'].map((name,index)=>({id:'N0'+(index+1)+'-first-'+name,first:true,reason:[undefined,null,false,0][index]})),{id:'N05-empty-string-double',reason:'',cleanup:'',double:true},{id:'N06-negative-zero-double',reason:-0,cleanup:-0,double:true},{id:'N07-row-publication-throws',reason:undefined,cleanup:false,double:true,publication:true},{id:'N08-success-flags-fd-zero',success:true}];
for(const item of cases){const primary=new Primary(),ledger={starts:0,active:0,stopped:false,rows:[]},row={},calls=[];let opened=0,closed=0,caught=false,selected,result;
 if(item.publication)ledger.rows=Object.freeze([]);
 const operations={openSync(filename,flags,mode){calls.push([filename,flags,mode]);opened++;if(item.first||(!item.success&&opened===2))throw item.reason;return opened-1;},closeSync(fd){closed++;assert.equal(fd,0);if(item.double)throw item.cleanup;}};
 try{result=openCapturePair({capture:'/INDEPENDENT/'+item.id},ledger,row,primary,operations);}catch(reason){caught=true;selected=reason;}
 assert.equal(ledger.starts,0);assert.equal(ledger.active,0);for(const call of calls){assert.equal(call[1],'wx+');assert.equal(call[2],384);}
 if(item.success){assert.deepEqual(result,{stdoutFd:0,stderrFd:1});assert.equal(caught,false);assert.equal(closed,0);assert.equal(primary.present,false);assert.equal(ledger.stopped,false);}
 else{assert.equal(caught,true);assert(Object.is(selected,item.reason));assert.equal(primary.present,true);assert(Object.is(primary.reason,item.reason));assert.equal(closed,item.first?0:1);assert.equal(row.childStarted,false);assert.equal(row.qualified,false);assert.equal(ledger.stopped,true);assert.equal(row.knownOutstanding,item.double?1:0);assert.equal(row.captureCleanup.closeAttempted,!item.first);assert.equal(row.captureCleanup.closed,!item.first&&!item.double);assert.equal(primary.secondary.length,item.double?1:0);if(item.double){assert.deepEqual(primary.secondary[0],errorRecord(item.cleanup));assert.equal(row.captureCleanup.failurePresent,true);}assert.equal(ledger.rows.length,item.publication?0:1);}
 rows.push({id:item.id,pass:true,reasonIdentityRetained:!item.success?Object.is(selected,item.reason):null,primaryPresent:primary.present,secondary:primary.secondary,knownOutstanding:row.knownOutstanding??0,closeAttempts:closed,recordPublication:item.publication?'refused-primary-retained':'normal'});
}
const result={author:authorRows,novel:rows,counts:{authorPassed:8,authorTotal:8,novelPassed:8,novelTotal:8},profile:'PURE injected operation callbacks; no actual native open/close fault, readiness, product or child dispatch',pid:process.pid};
fs.writeFileSync(fileURLToPath(new URL('RESULT.json',import.meta.url)),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:384});console.log(JSON.stringify(result.counts));
