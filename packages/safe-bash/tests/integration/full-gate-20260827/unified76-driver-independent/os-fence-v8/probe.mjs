import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
const input=JSON.parse(fs.readFileSync(process.argv[2]));
const mode=process.argv[3],root=input.root,output=input.output;
const events=[];
const exists=path=>{try{fs.lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
function deny(label,operation,path){
  let failure;try{operation();}catch(error){failure={code:error.code,message:error.message};}
  const present=exists(path);events.push({label,failure,present});
  assert.ok(failure&&['EPERM','EACCES'].includes(failure.code),label+' must deny');assert.equal(present,false,label+' published');
}
const source=join(root,'benign-source');
if(mode==='ordinary'){
  fs.mkdirSync(join(root,'ordinary'));fs.writeFileSync(source,'canary');fs.appendFileSync(source,'-append');
  fs.writeFileSync(join(root,'ordinary','before'),'rename');fs.renameSync(join(root,'ordinary','before'),join(root,'ordinary','after'));
  fs.writeFileSync(join(root,'ordinary\\literal'),'backslash');fs.writeFileSync(join(output,'ordinary-output'),'output');
  const temporary=fs.mkdtempSync(join(root,'tmp','probe-'));fs.writeFileSync(join(temporary,'ordinary'),'temp');
  assert.equal(fs.readFileSync(source,'utf8'),'canary-append');events.push({label:'ordinary',temporary,backslash:true});
}else if(mode==='names'){
  for(const name of ['AGENTS.md','agents.md','AgEnTs.Md','AGENTS.MD'])deny('create:'+name,()=>fs.writeFileSync(join(root,name),'benign-canary',{flag:'wx'}),join(root,name));
  deny('rename',()=>fs.renameSync(source,join(root,'AGENTS.md')),join(root,'AGENTS.md'));
  assert.equal(fs.readFileSync(source,'utf8'),'canary-append');
  deny('symlink-name',()=>fs.symlinkSync(source,join(root,'AGENTS.md')),join(root,'AGENTS.md'));
  deny('hardlink-name',()=>fs.linkSync(source,join(root,'AGENTS.md')),join(root,'AGENTS.md'));
}else if(mode==='imports'){
  deny('outside-write',()=>fs.writeFileSync(input.outsideTarget,'escape'),input.outsideTarget);
  deny('outside-hardlink',()=>fs.linkSync(input.canary,join(root,'imported-file')),join(root,'imported-file'));
  deny('outside-directory-rename',()=>fs.renameSync(input.outsideDirectory,join(root,'imported-directory')),join(root,'imported-directory'));
  deny('outside-directory-symlink',()=>fs.symlinkSync(input.outsideDirectory,join(root,'imported-link')),join(root,'imported-link'));
  assert.equal(fs.readFileSync(input.canary,'utf8'),'outside-canary');events.push({label:'synthetic-outside-read',allowed:true,qualification:'OS profile is a write boundary, not a private read firewall'});
}else if(mode==='descendants'){
  const descendant=`const fs=require('node:fs'),cp=require('node:child_process');let status;try{fs.writeFileSync(${JSON.stringify(join(root,'AGENTS.md'))},'benign');status='WRITTEN'}catch(e){status=e.code};const leaf=cp.spawnSync(${JSON.stringify(process.execPath)},['-e',${JSON.stringify(`try{require('node:fs').writeFileSync(${JSON.stringify(input.outsideTarget)},'benign');process.exitCode=12}catch(e){console.log(e.code);process.exitCode=e.code==='EPERM'?0:13}`)}],{env:{},encoding:'utf8',timeout:5000,maxBuffer:65536});console.log(JSON.stringify({pid:process.pid,nodeOptions:process.env.NODE_OPTIONS??null,status,leaf:{status:leaf.status,stdout:leaf.stdout,stderr:leaf.stderr}}));process.exitCode=status==='EPERM'&&leaf.status===0?0:14`;
  const node=spawnSync(process.execPath,['-e',descendant],{env:{},encoding:'utf8',timeout:12000,maxBuffer:65536});events.push({label:'node-descendants',status:node.status,stdout:node.stdout,stderr:node.stderr});assert.equal(node.status,0);assert.equal(exists(join(root,'AGENTS.md')),false);assert.equal(exists(input.outsideTarget),false);
  const script=`printf 'native' > "$1/native-ordinary"; printf '+append' >> "$1/native-ordinary"; printf 'parent=%s\\n' "$$"; /bin/sh -c 'printf "child=%s\\n" "$$"; printf benign > "$1/AGENTS.md"; result=$?; test "$result" -ne 0' child "$1"`;
  const native=spawnSync('/bin/sh',['-c',script,'parent',root],{env:{},encoding:'utf8',timeout:10000,maxBuffer:65536});events.push({label:'native-descendants',status:native.status,stdout:native.stdout,stderr:native.stderr});assert.equal(native.status,0);assert.equal(fs.readFileSync(join(root,'native-ordinary'),'utf8'),'native+append');assert.equal(exists(join(root,'AGENTS.md')),false);
}else if(mode==='shipping-fds'){
  const descriptors=[];for(let descriptor=0;descriptor<128;descriptor++){try{const stat=fs.fstatSync(descriptor);descriptors.push({descriptor,regular:stat.isFile(),device:stat.dev,inode:stat.ino});assert.ok(!(stat.isFile()&&stat.dev===input.canaryIdentity.device&&stat.ino===input.canaryIdentity.inode),'inherited outside canary descriptor');}catch(error){if(error.code!=='EBADF')throw error;}}
  events.push({label:'shipping-fds',descriptors});
}else throw Error('Unknown independent probe');
console.log(JSON.stringify({mode,pid:process.pid,ppid:process.ppid,node:process.execPath,nodeOptions:process.env.NODE_OPTIONS??null,events}));
