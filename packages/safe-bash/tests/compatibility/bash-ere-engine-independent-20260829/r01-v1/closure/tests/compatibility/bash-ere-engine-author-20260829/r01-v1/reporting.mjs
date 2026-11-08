import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const [directory,fixture,selection='all']=process.argv.slice(2),files={};
for(const name of ['types','errors','limits','syntax','matcher']){
 const path=`${directory}/${name}.js`,stat=await lstat(path);
 assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1048576);
 files[name]={path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};
}
console.log(JSON.stringify({event:'loaded',execPath:process.execPath,version:process.version,files}));
const {EreLedger}=await import(pathToFileURL(`${directory}/limits.js`));
const {compileEre}=await import(pathToFileURL(`${directory}/syntax.js`));
const {matchEre}=await import(pathToFileURL(`${directory}/matcher.js`));
const {EreProfileLimitError}=await import(pathToFileURL(`${directory}/errors.js`));
const bounds={maxExpansionBytes:1048576,maxExpansionFields:8192},rows=[];
async function check(id,body){if(selection!=='all'&&selection!==id)return;try{await body();rows.push({id,pass:true});}catch(error){rows.push({id,pass:false,name:error?.name,message:String(error?.stack??error),actual:error?.actual,expected:error?.expected});}}
for(const row of JSON.parse(await readFile(fixture,'utf8'))){await check(row.id,async()=>{
 let status,values=[];const ledger=new EreLedger(bounds);
 try{const observed=await matchEre(await compileEre(row.pattern,ledger),row.subject,ledger);status=observed.matched?0:1;values=observed.values;}
 catch(error){if(error.name!=='EreSyntaxError'||error.status!==2)throw error;status=2;}
 assert.deepEqual({status,cardinality:values.length,values},{status:row.status,cardinality:row.cardinality,values:row.values});
});}
await check('R01-branch-isolation',async()=>{
 const ledger=new EreLedger(bounds),observed=await matchEre(await compileEre('(a(b)?|c)+',ledger),'abc',ledger);
 assert.deepEqual(observed.values,['abc','c','']);assert.deepEqual(observed.captures,[{start:0,end:3},{start:2,end:3},null]);
});
await check('R02-reset-checkpoint',async()=>{
 class Observed extends EreLedger{work=0;prior=0;maximum=0;charge(resource,amount,signal){super.charge(resource,amount,signal);if(resource==='work')this.work+=amount;}async checkpoint(signal){this.maximum=Math.max(this.maximum,this.work-this.prior);this.prior=this.work;return super.checkpoint(signal);}}
 const ledger=new Observed(bounds),program=await compileEre('('+'a'.repeat(300)+'(b))',ledger);ledger.maximum=0;ledger.prior=ledger.work;
 const observed=await matchEre(program,'a'.repeat(300)+'b',ledger);assert.equal(observed.matched,true);assert.ok(ledger.maximum<=256,`reset work gap ${ledger.maximum}`);
});
await check('R03-copy-admission',async()=>{
 class Refusal extends EreLedger{armed=false;saw=false;charge(resource,amount,signal){if(this.armed&&resource==='allocationUnits'&&amount===6){this.saw=true;return super.charge(resource,4000001,signal);}return super.charge(resource,amount,signal);}}
 const ledger=new Refusal(bounds),program=await compileEre('(a(b)?)+',ledger);ledger.armed=true;
 await assert.rejects(matchEre(program,'aba',ledger),error=>error instanceof EreProfileLimitError&&error.resource==='allocationUnits'&&error.status===3);assert.equal(ledger.saw,true);
});
await check('R04-falsy-caller',async()=>{
 const controller=new AbortController();class Cancel extends EreLedger{armed=false;saw=false;charge(resource,amount,signal){if(this.armed&&resource==='allocationUnits'&&amount===6){this.saw=true;controller.abort(false);}return super.charge(resource,amount,signal);}}
 const ledger=new Cancel(bounds),program=await compileEre('(a(b)?)+',ledger);ledger.armed=true;let caught=Symbol('not-rejected');
 try{await matchEre(program,'aba',ledger,controller.signal);}catch(reason){caught=reason;}assert.equal(caught,false);assert.equal(ledger.saw,true);
});
const pass=rows.filter(row=>row.pass).length,fail=rows.length-pass;
console.log(JSON.stringify({event:'results',rows,pass,fail}));if(rows.length!==(selection==='all'?16:1)||fail)process.exitCode=1;
