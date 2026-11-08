import test from 'node:test';import assert from 'node:assert/strict';
import {streamLogFile,waitForExit,wrapForLogTee} from '../dist/index.js';import {native} from '../dist/native.js';
test('shell wrapping quotes every UTF-16 argument and retains exact original script structure',()=>{
 function quote(text){return "'"+text.replaceAll("'","'\\''")+"'";}
 for(const argv of [['echo','a\'b','$(never execute)','line\nnext','\ud800'],['',';'],['tool']])for(const job of ["job'id",'😀','space job']){
  const log=quote(`/tmp/poe-jobs/${job}.log`),exit=quote(`/tmp/poe-jobs/${job}.exit`),tmp=quote(`/tmp/poe-jobs/${job}.exit.tmp`);
  const checks=[`test ! -L ${quote('/tmp/poe-jobs')}`,`test ! -L ${log}`,`test ! -L ${exit}`,`test ! -L ${tmp}`].join(' && ');
  const script=[`mkdir -p ${quote('/tmp/poe-jobs')}`,checks,`({ (${argv.map(quote).join(' ')}); echo $? > ${tmp}; } 2>&1 | tee ${log}; mv ${tmp} ${exit})`].join(' && ');
  assert.deepEqual(wrapForLogTee(argv,job),['sh','-c',script]);
 }
});
test('UTF-8 prefix logic matches every tail byte with one to four continuation bytes',()=>{
 const expected=bytes=>{let lead=bytes.length-1;while(lead>=0&&bytes[lead]>=0x80&&bytes[lead]<=0xbf)lead--;if(lead<0)return bytes.length;const byte=bytes[lead],n=byte>=0xc2&&byte<=0xdf?2:byte>=0xe0&&byte<=0xef?3:byte>=0xf0&&byte<=0xf4?4:0;return n&&bytes.length-lead<n?lead:bytes.length;};
 for(let byte=0;byte<256;byte++)for(let count=0;count<5;count++){const bytes=Buffer.from([65,byte,...Array(count).fill(0x80)]);assert.equal(native.harnessUtf8Prefix(bytes),expected(bytes));}
 for(const value of ['0','255','9007199254740993','9'.repeat(400)])assert.equal(native.harnessDecimalExitCode(value),Number(value));
});
test('synchronous watch notification releases the returned watcher exactly once',async()=>{
 let log=null,closed=0;
 const fs={promises:{async readFile(target){if(target.endsWith('.log')&&log!==null)return log;throw {code:'ENOENT'};}},watch(_target,listener){log=Buffer.from('ready');listener();return {close(){closed++;}};}};
 const iterator=streamLogFile({fs},'job',{});assert.deepEqual(await iterator.next(),{value:{byteOffset:0,data:'ready'},done:false});await iterator.return();assert.equal(closed,1);
});
test('invalid job IDs reject before any injected IO and exit polling preserves failures',async()=>{
 let calls=0;const error={code:'EACCES'},fs={promises:{async readFile(){calls++;throw error;}}};
 for(const id of ['../x','nul\0id','']){await assert.rejects(streamLogFile({fs},id,{}).next(),/Invalid job id/);await assert.rejects(waitForExit({fs},id),/Invalid job id/);}
 assert.equal(calls,0);await assert.rejects(waitForExit({fs},'safe'),e=>e===error);
});
