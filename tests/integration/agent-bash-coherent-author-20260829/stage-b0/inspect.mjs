import {fs,path,read,sha,assert,streamHash} from '../stage-b/io.mjs';
import {spawnSync} from 'node:child_process';
const base=path.dirname(import.meta.dirname),out=import.meta.dirname;
const started=new Date().toISOString();
await streamHash('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node',{bytes:112989184,sha256:'5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'});
await streamHash('/usr/bin/git',{bytes:118928,sha256:'12bed4523661307059b879b9b54e77a73176e9d27d27a0e40363271d8f0668ba'});
for(const [role,args]of [['status',['status','--porcelain=v1','-z','--untracked-files=normal','--',path.relative('/Users/kjopek/Workspace/safe-bash',out)]],['index',['diff','--cached','--name-only','-z']]]){const output=fs.openSync(path.join(out,'capture',role+'.nul'),'wx'),error=fs.openSync(path.join(out,'capture',role+'.stderr'),'wx');let result;try{result=spawnSync('/usr/bin/git',args,{cwd:'/Users/kjopek/Workspace/safe-bash',env:{PATH:'/usr/bin:/bin',GIT_OPTIONAL_LOCKS:'0'},stdio:['ignore',output,error],timeout:10000});}finally{fs.closeSync(output);fs.closeSync(error);}assert.equal(result.status,0);assert.equal(result.signal,null);console.log(JSON.stringify({role,pid:result.pid,status:result.status}));}
const bindings=JSON.parse(read(path.join(base,'stage-a-r2/BINDINGS.json'),1048576,{bytes:fs.statSync(path.join(base,'stage-a-r2/BINDINGS.json')).size,sha256:'1b9f9f6a01f192cbd8a9f8b94716522ca7aff7ee2c7f679994f72e98256f0b7c'}));
const inherited=JSON.parse(read(path.join(base,'stage-b/inherited/PRESEAL.json'),65536,{bytes:47291,sha256:'8acc5e35686a4fa20bf1f8a871b2c23edff4cb29b09a9b9f1848ffc1332006db'}));
const retained=JSON.parse(read(path.join(base,'stage-b/RETAINED-SOURCES.json'),2097152));
for(const row of retained.filter(row=>/\/(resources|loader)\.mjs$/.test(row.path))){assert.equal(sha(Buffer.from(row.text??row.body)),row.sha256);console.log(JSON.stringify({kind:'qualified-helper',...row}));}
const workflows=read(path.join(base,'v4/workflows.mjs'),16384,{bytes:15763,sha256:'6d8a19854a6e96986013ed3d94ee15dd774e225259dea922bf4749799c60d89b'}).toString().split('\n');console.log(JSON.stringify({workflows:workflows.map((text,index)=>({line:index+1,text})).filter(row=>row.line<=72||(row.line>=80&&row.line<=100)||(row.line>=116&&row.line<=127))}));
console.log(JSON.stringify({presealKeys:Object.keys(inherited),preseal:inherited},null,2));
fs.writeFileSync(path.join(out,'INSPECT.json'),JSON.stringify({started,finished:new Date().toISOString(),bindings,inherited,productImports:0},null,2)+'\n',{flag:'wx'});
