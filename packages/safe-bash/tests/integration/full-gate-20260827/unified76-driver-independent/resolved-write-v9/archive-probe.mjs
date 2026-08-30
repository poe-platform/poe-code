import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const input=JSON.parse(readFileSync(process.argv[2])),root=input.root,git='/Applications/Xcode.app/Contents/Developer/usr/bin/git',revision='656ee2b04aa91b1cc40da865173be1b472a2c4ce';
const environment={PATH:'/usr/bin:/bin',HOME:join(root,'home'),TMPDIR:join(root,'tmp'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_OPTIONAL_LOCKS:'0',LC_ALL:'C'};
const paths=['src','package.json','tsconfig.json','tsconfig.build.json','README.md','AGENTS.md'];
const metadata=spawnSync(git,['--no-replace-objects','ls-tree','-rlz',revision,'--',...paths],{cwd:input.repository,env:environment,timeout:10000,maxBuffer:1048576});assert.equal(metadata.status,0);
const entries=metadata.stdout.toString().split('\0').filter(Boolean).map(row=>{const split=row.indexOf('\t'),[mode,type,blob,bytes]=row.slice(0,split).trim().split(/\s+/u);return{path:row.slice(split+1),mode,type,blob,bytes:Number(bytes)};});
const instruction=entries.find(entry=>entry.path==='AGENTS.md');assert.deepEqual(instruction,{path:'AGENTS.md',mode:'100644',type:'blob',blob:'c6842fcf96700eb14d2292f7907a33c335ac8eaf',bytes:10300});
const children=[],logs=[];
function start(args){const child=spawn(args[0],args.slice(1),{cwd:input.repository,env:environment,stdio:['pipe','pipe','pipe']});children.push(child);const log={args,pid:child.pid,stderr:''};logs.push(log);child.stderr.on('data',chunk=>{log.stderr+=chunk;assert.ok(Buffer.byteLength(log.stderr)<1048576);});child.finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(status,signal)=>{log.status=status;log.signal=signal;resolve(log);});});return child;}
const timer=setTimeout(()=>children.forEach(child=>child.kill('SIGKILL')),20000);
try{
  const blob=start([git,'--no-replace-objects','cat-file','blob',instruction.blob]);blob.stdin.end();let length=0;const content=createHash('sha256'),object=createHash('sha1').update('blob 10300\0');
  await pipeline(blob.stdout,new Writable({write(chunk,encoding,callback){length+=chunk.length;content.update(chunk);object.update(chunk);callback(length>10300?Error('blob size bound'):undefined);}}));assert.equal((await blob.finished).status,0);assert.equal(length,10300);assert.equal(object.digest('hex'),instruction.blob);instruction.sha256=content.digest('hex');
  const destination=join(root,'historical-extraction');mkdirSync(destination);
  const archive=start([git,'--no-replace-objects','archive','--format=tar',revision,...paths]),tar=start(['/usr/bin/tar','-xf','-','-C',destination]);archive.stdin.end();tar.stdout.resume();let bytes=0;const hash=createHash('sha256');
  await pipeline(archive.stdout,new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;hash.update(chunk);callback(bytes>134217728?Error('archive limit'):null,chunk);}}),tar.stdin);
  const [archiveResult,tarResult]=await Promise.all([archive.finished,tar.finished]);assert.equal(archiveResult.status,0);assert.ok(tarResult.status!==0&&tarResult.signal===null);assert.match(tarResult.stderr,/AGENTS\.md/u);assert.match(tarResult.stderr,/Operation not permitted|Permission denied/u);assert.equal(existsSync(join(destination,'AGENTS.md')),false);
  const physical=[];for(const entry of entries.filter(entry=>entry.path!=='AGENTS.md')){const path=join(destination,entry.path);if(!existsSync(path)){physical.push({...entry,present:false});continue;}const stat=lstatSync(path);assert.ok(stat.isFile());const actual=readFileSync(path);assert.equal(actual.length,entry.bytes);assert.equal(createHash('sha1').update(`blob ${actual.length}\0`).update(actual).digest('hex'),entry.blob);physical.push({...entry,present:true,sha256:createHash('sha256').update(actual).digest('hex')});}
  assert.ok(physical.find(entry=>entry.path==='package.json')?.present);const report={status:'HISTORICAL_NATIVE_TAR_INSTRUCTION_DENIAL',revision,instruction,archive:{bytes,sha256:hash.digest('hex'),stored:false},logs,physical,instructionTargetAbsent:true,instructionAttempts:1,fullGate:false,qualification:'Actual native Git/tar reached AGENTS denial; ordinary partial publication is allowed, no rollback claim. Instruction bytes only streamed into hashes/tar, never stdout evidence or archive file.'};
  writeFileSync(join(input.output,'HISTORICAL-TAR.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,archive:report.archive,instruction:report.instruction,ordinaryPublished:physical.filter(entry=>entry.present).length,tarStatus:tarResult.status}));
}finally{clearTimeout(timer);}
