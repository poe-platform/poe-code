import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [directory]=process.argv.slice(2),files={};
for(const name of ['types','errors','limits','syntax','matcher']) {
  const path=`${directory}/${name}.js`,stat=await fs.lstat(path);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1048576);
  files[name]={path,sha256:crypto.createHash('sha256').update(await fs.readFile(path)).digest('hex')};
}
console.log(JSON.stringify({event:'loaded',execPath:process.execPath,version:process.version,files}));
const {EreLedger}=await import(pathToFileURL(`${directory}/limits.js`));
const {compileEre}=await import(pathToFileURL(`${directory}/syntax.js`));
const {matchEre}=await import(pathToFileURL(`${directory}/matcher.js`));
const {EreProfileLimitError}=await import(pathToFileURL(`${directory}/errors.js`));
const bounds={maxExpansionBytes:1048576,maxExpansionFields:8192},rows=[];
async function check(id,body){try{await body();rows.push({id,pass:true});}catch(error){rows.push({id,pass:false,name:error?.name,message:String(error?.stack??error),actual:error?.actual,expected:error?.expected});}}
const semantic=[
 ['J01','^Q((a(b)?)c)+Z$','QabcacZ',['QabcacZ','ac','a','']],
 ['J02','^Q((x(y)?|z)q)+Z$','QxyqzqZ',['QxyqzqZ','zq','z','']],
 ['J03','^Q((a(b)?)+x|abaz)Z$','QabazZ',['QabazZ','abaz','','']],
 ['J04','^Q((a(b)?)+|abac)Z$','QabaZ',['QabaZ','aba','a','']],
 ['J05','^Q((a|aa)(a?))Z$','QaaZ',['QaaZ','aa','aa','']],
 ['J06','^Q((aa|a)(a?))Z$','QaaZ',['QaaZ','aa','aa','']],
 ['J07','^Q((a|aa)+)(a?)Z$','QaaaZ',['QaaaZ','aaa','a','']],
 ['J08','^Q((ab)?c)+Z$','QabccZ',['QabccZ','c','']],
 ['J09','^Q((ab)?c){2}Z$','QabccZ',['QabccZ','c','']],
 ['J10','^Q((ab)?c){1}Z$','QabcZ',['QabcZ','abc','ab']],
 ['J11','^Q((ab)?c){0}Z$','QZ',['QZ','','']],
 ['J12','^Q((a(b)?)+)(c(d)?)Z$','QabacdZ',['QabacdZ','aba','a','','cd','d']],
 ['J13','^Q((a(b)?)+)(c(d)?)Z$','QabacZ',['QabacZ','aba','a','','c','']],
 ['J14','^Q((a*)b)+Z$','QaabbZ',['QaabbZ','b','']],
 ['J15','^Q((a)?b)+Z$','QabbZ',['QabbZ','b','']],
 ['J16','Q((a(b)?)+)Z','xxQabaZyy',['QabaZ','aba','a','']],
 ['J17','^Q((a(b)?)+)Z$','xxQabaZyy',[]],
 ['J18','^Q((a(b)?)+|((aba)))Z$','QabaZ',['QabaZ','aba','a','','','']],
];
for(const [id,pattern,subject,values]of semantic) await check(id,async()=>{
 const ledger=new EreLedger(bounds),result=await matchEre(await compileEre(pattern,ledger),subject,ledger);
 assert.equal(result.matched,values.length>0);assert.deepEqual(result.values,values);
 assert.equal(result.captures.length,values.length);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.values)&&Object.isFrozen(result.captures));
 if(id==='J14') assert.notEqual(result.captures[2],null);
 if(id==='J15') assert.equal(result.captures[2],null);
});
await check('J19-cumulative-ledger',async()=>{
 const ledger=new EreLedger(bounds),program=await compileEre('^Q(a(b)?)+Z$',ledger),before=ledger.usage;
 const first=await matchEre(program,'QabaZ',ledger),middle=ledger.usage;
 const second=await matchEre(program,'QabZ',ledger),after=ledger.usage;
 assert.deepEqual(first.values,['QabaZ','a','']);assert.deepEqual(second.values,['QabZ','ab','b']);assert.deepEqual(first.values,['QabaZ','a','']);
 for(const name of ['work','states','allocationUnits','captureBytes','captureSlots']) assert.ok(after[name]>middle[name]&&middle[name]>before[name]);
});
await check('J20-falsy-preabort',async()=>{
 for(const reason of [false,0,'',null]){const ledger=new EreLedger(bounds),program=await compileEre('(a(b)?)+',ledger),before=ledger.usage,controller=new AbortController();controller.abort(reason);let caught=Symbol('unrejected');try{await matchEre(program,'aba',ledger,controller.signal);}catch(error){caught=error;}assert.equal(caught,reason);assert.deepEqual(ledger.usage,before);}
});
await check('J21-zero-work-profile',async()=>{
 const ledger=new EreLedger(bounds,{work:0});await assert.rejects(compileEre('(a(b)?)+',ledger),error=>error instanceof EreProfileLimitError&&error.resource==='work'&&error.status===3);assert.equal(ledger.usage.work,0);
});
await check('J22-reset-rejection-identity',async()=>{
 const reason=Object.freeze({kind:'owned-reset-test'});
 class Probe extends EreLedger{armed=false;seen=false;charge(resource,amount,signal){if(this.armed&&resource==='allocationUnits'&&amount===6){this.seen=true;throw reason;}return super.charge(resource,amount,signal);}}
 const ledger=new Probe(bounds),program=await compileEre('(a(b)?)+',ledger);ledger.armed=true;let caught;
 try{await matchEre(program,'aba',ledger);}catch(error){caught=error;}assert.equal(caught,reason);assert.equal(ledger.seen,true);
});
await check('J23-reset-scan-checkpoints',async()=>{
 class Probe extends EreLedger{previous=0;gap=0;async checkpoint(signal){const now=this.usage.work;this.gap=Math.max(this.gap,now-this.previous);this.previous=now;return super.checkpoint(signal);}}
 const ledger=new Probe(bounds),program=await compileEre('^Q(('+'a'.repeat(200)+'(b)?|c)d)+Z$',ledger);ledger.previous=ledger.usage.work;ledger.gap=0;
 const result=await matchEre(program,'Q'+'a'.repeat(200)+'bdcdZ',ledger);assert.deepEqual(result.values,['Q'+'a'.repeat(200)+'bdcdZ','cd','c','']);assert.ok(ledger.gap<=256);
});
await check('J24-safe-overflow-rejection',async()=>{
 const ledger=new EreLedger({maxExpansionBytes:Number.MAX_SAFE_INTEGER,maxExpansionFields:Number.MAX_SAFE_INTEGER});assert.equal(ledger.limits.work,50000000);assert.equal(ledger.limits.allocationUnits,4000000);
 const before=ledger.usage;assert.throws(()=>ledger.charge('allocationUnits',Number.MAX_SAFE_INTEGER),error=>error instanceof EreProfileLimitError&&error.status===3);assert.deepEqual(ledger.usage,before);assert.throws(()=>ledger.charge('work',Infinity),TypeError);
});
const fail=rows.filter(row=>!row.pass).length;console.log(JSON.stringify({event:'results',rows,pass:rows.length-fail,fail}));if(rows.length!==24||fail)process.exitCode=1;
