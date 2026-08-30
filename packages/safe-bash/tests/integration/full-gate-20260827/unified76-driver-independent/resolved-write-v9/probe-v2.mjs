import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const input=JSON.parse(fs.readFileSync(process.argv[2])),mode=process.argv[3],root=input.root,output=input.output,events=[];
const exists=path=>{try{fs.lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const hash=path=>createHash('sha256').update(fs.readFileSync(path)).digest('hex');
function snapshot(){const files={};function walk(path){const stat=fs.lstatSync(path);files[path]={inode:stat.ino,device:stat.dev,links:stat.nlink,mode:stat.mode&0o777,kind:stat.isDirectory()?'directory':stat.isSymbolicLink()?'symlink':'file'};if(stat.isDirectory())for(const name of fs.readdirSync(path).sort())walk(join(path,name));else if(stat.isFile())files[path].sha256=hash(path);else files[path].target=fs.readlinkSync(path);}walk(input.canary);walk(input.outsideDirectory);return files;}
const before=snapshot();
function deny(label,operation,target,{absent=false,instruction=false}={}){let failure;try{operation();}catch(error){failure={code:error.code,message:error.message};}const present=exists(target);events.push({label,target,instruction,failure,present});assert.ok(failure&&['EPERM','EACCES'].includes(failure.code),label+' write/import must deny');if(absent)assert.equal(present,false,label+' published target');assert.deepEqual(snapshot(),before,label+' outside state changed');}
function positive(label,operation){operation();events.push({label,positive:true});}
try{
  if(mode==='outside-links'){
    positive('inert outside file link',()=>fs.symlinkSync(input.canary,join(root,'outside-file')));
    positive('inert outside directory link',()=>fs.symlinkSync(input.outsideDirectory,join(root,'outside-dir')));
    for(const [name,operation]of [['write',path=>fs.writeFileSync(path,'bad')],['append',path=>fs.appendFileSync(path,'bad')],['truncate',path=>fs.truncateSync(path,0)]])deny('file-link-'+name,()=>operation(join(root,'outside-file')),input.canary);
    deny('directory-child-create',()=>fs.writeFileSync(join(root,'outside-dir','new-child'),'bad'),join(input.outsideDirectory,'new-child'),{absent:true});
    positive('relative chain',()=>{fs.symlinkSync('outside-dir',join(root,'chain'));fs.renameSync(join(root,'chain'),join(root,'renamed-chain'));});
    deny('renamed-relative-chain',()=>fs.appendFileSync(join(root,'renamed-chain','benign'),'bad'),join(input.outsideDirectory,'benign'));
    fs.mkdirSync(join(root,'aliases'));fs.symlinkSync(relative(join(root,'aliases'),input.canary),join(root,'aliases','relative-file'));
    deny('relative-dot-alias',()=>fs.writeFileSync(join(root,'aliases','..','aliases','relative-file'),'bad'),input.canary);
    fs.symlinkSync(input.outsideDirectory.replace('/private/tmp/','/tmp/'),join(root,'tmp-alias'));
    deny('tmp-private-alias',()=>fs.writeFileSync(join(root,'tmp-alias','new-child'),'bad'),join(input.outsideDirectory,'new-child'),{absent:true});
    fs.mkdirSync(join(root,'inside'));fs.symlinkSync('inside',join(root,'contained'));fs.writeFileSync(join(root,'contained','ordinary'),'inside');fs.appendFileSync(join(root,'contained','ordinary'),'+append');assert.equal(fs.readFileSync(join(root,'inside','ordinary'),'utf8'),'inside+append');events.push({label:'contained ordinary write',positive:true});
    fs.writeFileSync(join(root,'ordinary\\literal'),'POSIX');fs.writeFileSync(join(output,'ordinary-output'),'output');assert.equal(fs.readFileSync(join(output,'ordinary-output'),'utf8'),'output');events.push({label:'exact output and literal backslash',positive:true});
    deny('outside-exact-output',()=>fs.writeFileSync(input.outsideTarget,'bad'),input.outsideTarget,{absent:true});
  }else if(mode==='alias-targets'){
    for(const [index,targetName]of ['AGENTS.md','agents.md','AgEnTs.Md','AGENTS.MD'].entries()){
      const target=join(root,targetName),alias=join(root,'instruction-alias-'+index);assert.equal(exists(target),false);
      fs.symlinkSync(targetName,alias);fs.symlinkSync('instruction-alias-'+index,join(root,'instruction-chain-'+index));fs.renameSync(join(root,'instruction-chain-'+index),join(root,'instruction-renamed-'+index));
      deny('alias-create-'+targetName,()=>fs.writeFileSync(alias,'benign-canary'),target,{absent:true,instruction:true});
      deny('renamed-chain-append-'+targetName,()=>fs.appendFileSync(join(root,'instruction-renamed-'+index),'benign-canary'),target,{absent:true,instruction:true});
    }
    deny('instruction-link-name',()=>fs.symlinkSync('inside',join(root,'AGENTS.md')),join(root,'AGENTS.md'),{absent:true,instruction:true});
  }else if(mode==='physical-imports'){
    deny('outside-hardlink-import',()=>fs.linkSync(input.canary,join(root,'hardlink-import')),join(root,'hardlink-import'),{absent:true});
    deny('outside-hardlink-through-alias',()=>fs.linkSync(join(root,'outside-dir','benign'),join(root,'hardlink-import-alias')),join(root,'hardlink-import-alias'),{absent:true});
    deny('physical-directory-rename',()=>fs.renameSync(input.outsideDirectory,join(root,'physical-import')),join(root,'physical-import'),{absent:true});
    deny('physical-directory-tmp-alias-rename',()=>fs.renameSync(input.outsideDirectory.replace('/private/tmp/','/tmp/'),join(root,'physical-import-alias')),join(root,'physical-import-alias'),{absent:true});
  }else if(mode==='descendants'){
    const target=join(root,'instruction-renamed-0'),outside=join(root,'renamed-chain','benign');
    const grandchild=`const fs=require('node:fs');const targets=${JSON.stringify([outside,target])};const rows=targets.map(path=>{try{fs.appendFileSync(path,'benign');return{path,status:'WRITTEN'}}catch(e){return{path,status:e.code}}});console.log(JSON.stringify({pid:process.pid,ppid:process.ppid,nodeOptions:process.env.NODE_OPTIONS??null,rows}));process.exitCode=rows.every(row=>row.status==='EPERM')?0:12`;
    const child=`const cp=require('node:child_process');const result=cp.spawnSync(process.execPath,['-e',${JSON.stringify(grandchild)}],{env:{},encoding:'utf8',timeout:6000,maxBuffer:65536});console.log(JSON.stringify({pid:process.pid,nodeOptions:process.env.NODE_OPTIONS??null,status:result.status,stdout:result.stdout,stderr:result.stderr}));process.exitCode=result.status===0?0:13`;
    const node=spawnSync(process.execPath,['-e',child],{env:{},encoding:'utf8',timeout:12000,maxBuffer:65536});events.push({label:'cleared Node child/grandchild',status:node.status,stdout:node.stdout,stderr:node.stderr,instructionAttempts:1});assert.equal(node.status,0);assert.deepEqual(snapshot(),before);assert.equal(exists(join(root,'AGENTS.md')),false);
    const script=`printf 'parent=%s\\n' "$$"; /bin/sh -c 'printf "child=%s\\n" "$$"; printf native > "$1/contained/native" || exit 20; printf append >> "$1/contained/native" || exit 21; printf bad >> "$1/renamed-chain/benign"; first=$?; printf benign > "$1/instruction-renamed-1"; second=$?; test "$first" -ne 0 && test "$second" -ne 0' child "$1"`;
    const native=spawnSync('/bin/sh',['-c',script,'parent',root],{env:{},encoding:'utf8',timeout:10000,maxBuffer:65536});events.push({label:'cleared native child/grandchild',status:native.status,stdout:native.stdout,stderr:native.stderr,instructionAttempts:1});assert.equal(native.status,0);assert.equal(fs.readFileSync(join(root,'inside','native'),'utf8'),'nativeappend');assert.deepEqual(snapshot(),before);assert.equal(exists(join(root,'agents.md')),false);
  }else if(mode==='shipping-fds'){
    const descriptors=[];for(let descriptor=0;descriptor<128;descriptor++){try{const stat=fs.fstatSync(descriptor);descriptors.push({descriptor,regular:stat.isFile(),device:stat.dev,inode:stat.ino});assert.ok(!(stat.isFile()&&stat.dev===input.canaryIdentity.device&&stat.ino===input.canaryIdentity.inode));}catch(error){if(error.code!=='EBADF')throw error;}}events.push({label:'parent canary FD not inherited',descriptors});
  }else throw Error('Unknown probe mode');
  assert.deepEqual(snapshot(),before);console.log(JSON.stringify({mode,pid:process.pid,ppid:process.ppid,events,outsideBefore:before,outsideAfter:snapshot(),status:'PASS'}));
}catch(error){console.log(JSON.stringify({mode,pid:process.pid,ppid:process.ppid,events,outsideBefore:before,outsideAfter:snapshot(),status:'FAIL',error:{message:error.message,stack:error.stack}}));throw error;}
