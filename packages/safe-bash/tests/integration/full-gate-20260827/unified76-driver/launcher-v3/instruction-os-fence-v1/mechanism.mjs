import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {node24,save} from '../common.mjs';
import {createInstructionFence,instructionFenceInvocation,validateInstructionFence,verifyInstructionFenceExternal} from '../os-instruction-fence.mjs';
import {supervise} from '../supervise.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const outer=realpathSync(mkdtempSync('/private/tmp/unified76-os-mechanism-'));
const outside=join(outer,'outside');mkdirSync(outside);writeFileSync(join(outside,'ordinary'),'unchanged');
mkdirSync(join(outside,'directory'));writeFileSync(join(outside,'directory','ordinary'),'unchanged');
const external=verifyInstructionFenceExternal();
const cases=[
  ['C01',`const file=join(root,'ordinary');writeFileSync(file,'a');appendFileSync(file,'b');assert.equal(readFileSync(file,'utf8'),'ab');renameSync(file,join(root,'renamed'));linkSync(join(root,'renamed'),join(root,'hard'));assert.equal(readFileSync(join(root,'hard'),'utf8'),'ab');symlinkSync('renamed',join(root,'soft'));assert.equal(readFileSync(join(root,'soft'),'utf8'),'ab');for(const name of ['agents.md.txt','MYAGENTS.md','README.md'])writeFileSync(join(root,name),'ok');unlinkSync(join(root,'renamed'));unlinkSync(join(root,'hard'));unlinkSync(join(root,'soft'));`],
  ['C04',`denied(()=>writeFileSync(join(root,'AGENTS.md'),''));assert.equal(existsSync(join(root,'AGENTS.md')),false);`],
  ['C05',`const child=spawnSync('/usr/bin/env',['-i','/bin/sh','-c',': > "$1/AGENTS.md"','sh',root],{encoding:'utf8'});assert.equal(child.status,1);assert.equal(child.signal,null);assert.match(child.stderr,/Operation not permitted|Permission denied/u);assert.equal(existsSync(join(root,'AGENTS.md')),false);`],
  ['C06',`const source="import{writeFileSync}from'node:fs';writeFileSync(process.argv[1],'')";const child=spawnSync(node,['--input-type=module','-e',source,join(root,'AGENTS.md')],{env:{},encoding:'utf8'});assert.equal(child.status,1);assert.equal(child.signal,null);assert.match(child.stderr,/EPERM|EACCES/u);assert.equal(existsSync(join(root,'AGENTS.md')),false);`],
  ['C09',`const source=join(root,'ordinary');writeFileSync(source,'original');denied(()=>renameSync(source,join(root,'AGENTS.md')));assert.equal(readFileSync(source,'utf8'),'original');assert.equal(existsSync(join(root,'AGENTS.md')),false);`],
  ['C10',`const source=join(root,'ordinary');writeFileSync(source,'original');const before=lstatSync(source).nlink;denied(()=>linkSync(source,join(root,'AGENTS.md')));assert.equal(lstatSync(source).nlink,before);assert.equal(existsSync(join(root,'AGENTS.md')),false);`],
  ['C11',`writeFileSync(join(root,'ordinary'),'original');denied(()=>symlinkSync('ordinary',join(root,'AGENTS.md')));assert.equal(existsSync(join(root,'AGENTS.md')),false);assert.equal(readFileSync(join(root,'ordinary'),'utf8'),'original');`],
  ['C12',`try{symlinkSync('AGENTS.md',join(root,'alias'));}catch(error){assert.ok(['EPERM','EACCES'].includes(error.code));}if(existsSync(join(root,'alias'))||(()=>{try{return lstatSync(join(root,'alias')).isSymbolicLink();}catch{return false;}})())denied(()=>writeFileSync(join(root,'alias'),''));assert.equal(existsSync(join(root,'AGENTS.md')),false);`],
  ['C13',`mkdirSync(join(root,'d'));symlinkSync('d',join(root,'alias'));for(const target of [root+'/d/../AGENTS.md',root+'/alias/../AGENTS.md',root+'//AGENTS.md',root+'/./AGENTS.md'])denied(()=>writeFileSync(target,''));assert.equal(existsSync(join(root,'AGENTS.md')),false);`],
  ['C14',`const letters='agentsmd';for(let mask=0;mask<256;mask++){const value=[...letters].map((letter,index)=>(mask&(1<<index))?letter.toUpperCase():letter).join('');const name=value.slice(0,6)+'.'+value.slice(6);denied(()=>writeFileSync(join(root,name),''));}assert.equal(readdirSync(root).some(name=>name.toLowerCase()==='agents.md'),false);`],
  ['C15',`for(const name of ['caf\u00e9','cafe\u0301','back\\\\slash']){const parent=join(root,name);try{mkdirSync(parent);}catch(error){assert.equal(error.code,'EEXIST');}writeFileSync(join(parent,'ordinary'),'ok');denied(()=>writeFileSync(join(parent,'aGeNtS.mD'),''));}`],
  ['C16',`denied(()=>renameSync(join(outside,'directory'),join(root,'imported')));assert.equal(readFileSync(join(outside,'directory','ordinary'),'utf8'),'unchanged');assert.equal(existsSync(join(root,'imported')),false);`],
  ['C17',`const file=join(outside,'ordinary'),before=lstatSync(file).nlink;denied(()=>linkSync(file,join(root,'imported')));assert.equal(lstatSync(file).nlink,before);assert.equal(existsSync(join(root,'imported')),false);`],
  ['C18',`try{symlinkSync(join(outside,'ordinary'),join(root,'outside-alias'));}catch(error){assert.ok(['EPERM','EACCES'].includes(error.code));}if(existsSync(join(root,'outside-alias')))denied(()=>writeFileSync(join(root,'outside-alias'),'changed'));assert.equal(readFileSync(join(outside,'ordinary'),'utf8'),'unchanged');`],
  ['C28-ps',`const result=spawnSync('/bin/ps',['-p',String(process.pid),'-o','pid=,ppid=,pgid='],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);assert.ok(result.stdout.includes(String(process.pid)));`],
];
const report={createdAt:new Date().toISOString(),outer,external,status:'RUNNING',cases:[],fullGate:false,builds:0,qualification:'First bounded mechanism tranche, not all30 controls or shipping-launcher qualification'};
try{
  for(const[id,body]of cases){
    const output='/tmp/full-gate-unified76-os-control-'+id+'-'+Date.now(),envelope=createInstructionFence(output);validateInstructionFence(envelope,{initial:true});
    const root=envelope.roots[0].path;
    const code=`import assert from'node:assert/strict';import{appendFileSync,existsSync,linkSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,symlinkSync,unlinkSync,writeFileSync}from'node:fs';import{join}from'node:path';import{spawnSync}from'node:child_process';const root=${JSON.stringify(root)},outside=${JSON.stringify(outside)},node=${JSON.stringify(node24)};const denied=call=>assert.throws(call,error=>['EPERM','EACCES'].includes(error?.code));${body}\nconsole.log(JSON.stringify({id:${JSON.stringify(id)},passed:true,pid:process.pid}));`;
    const script=join(outer,id+'.mjs');writeFileSync(script,code,{flag:'wx'});
    const invocation=instructionFenceInvocation(envelope,node24,[script],{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TZ:'UTC'});
    const result=await supervise(invocation.executable,invocation.args,{cwd:root,env:invocation.env,stdout:join(outer,id+'.stdout'),stderr:join(outer,id+'.stderr'),timeoutMs:30000,maxOutputBytes:1024*1024,observeSockets:true});
    const entries=readdirSync(root),row={id,envelope,sourceSha256:sha(code),...result,rootEntries:entries};report.cases.push(row);
    assert.equal(result.status,0,id+': '+readFileSync(join(outer,id+'.stderr'),'utf8'));assert.equal(result.signal,null);assert.equal(result.clean,true);assert.deepEqual(result.survivors,[]);
    assert.equal(entries.some(name=>name.toLowerCase()==='agents.md'),false,id+' published forbidden entry');
  }
  assert.deepEqual(verifyInstructionFenceExternal(),external);report.status='MECHANISM_TRANCHE_PASS';
}catch(error){report.status='MECHANISM_TRANCHE_FAIL_STOP';report.error=error.stack;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save(join(outer,'REPORT.json'),report);console.log(JSON.stringify({outer,status:report.status,cases:report.cases.map(row=>({id:row.id,status:row.status,clean:row.clean})),error:report.error,fullGate:false}));}
