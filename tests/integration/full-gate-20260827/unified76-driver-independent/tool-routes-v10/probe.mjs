import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,symlinkSync,readlinkSync,renameSync,linkSync,lstatSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
const input=JSON.parse(readFileSync(process.argv[2])),label=process.argv[3],root=input.root;
const records=[];const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=(file,args,env)=>{const result=spawnSync(file,args,{env,cwd:root,encoding:'utf8',timeout:10000,maxBuffer:1048576});return{file,args,env,status:result.status,signal:result.signal,error:result.error?{code:result.error.code,message:result.error.message}:null,stdout:result.stdout,stderr:result.stderr};};
const deny=(name,operation)=>{let error;try{operation();}catch(caught){error={code:caught.code,message:caught.message};}assert.ok(error,name+' unexpectedly succeeded');assert.ok(['EPERM','EACCES'].includes(error.code),JSON.stringify(error));records.push({name,error});};
if(label==='finite-git'){
  const bindings=JSON.parse(readFileSync(join(root,'tool-path.json'))),environment={PATH:bindings.path,GIT_EXEC_PATH:bindings.gitCore.origin,HOME:join(root,'home'),LANG:'C',LC_ALL:'C',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1'};
  for(const[file,args,env]of [['git',['--version'],environment],[input.git,['--version'],{}],['/bin/sh',['-c','printf native-empty-env'],{}]]){const result=run(file,args,env);assert.equal(result.status,0,JSON.stringify(result));records.push(result);}
  const absent=run('independent-unlisted-tool',[],environment);assert.equal(absent.error?.code,'ENOENT');records.push(absent);
  const repository=join(root,'benign-git');mkdirSync(repository);for(const args of [['init','--quiet','--template=',repository],['-C',repository,'ls-files','-z']]){const result=run('git',args,environment);assert.equal(result.status,0,JSON.stringify(result));records.push(result);}
}
if(label==='selectors'){
  for(const executable of input.selectors){const result=run(executable,['--version'],{});assert.equal(result.error?.code,'EPERM',JSON.stringify(result));records.push(result);}
  const descendant=run(process.execPath,['-e',`const {spawnSync}=require('node:child_process');const result=spawnSync(process.argv[1],['--version'],{env:{}});console.log(JSON.stringify({error:result.error?.code,status:result.status}));if(result.error?.code!=='EPERM')process.exit(91);`,input.selectors[3]],{});assert.equal(descendant.status,0,JSON.stringify(descendant));records.push(descendant);
}
if(label==='resolved-boundary'){
  const stat=lstatSync(input.canary),before={sha256:sha(readFileSync(input.canary)),inode:stat.ino,links:stat.nlink,directory:readdirSync(input.outsideDirectory).sort()};
  writeFileSync(join(root,'ordinary'),'inside');symlinkSync('ordinary',join(root,'contained'));writeFileSync(join(root,'contained'),'contained-positive');assert.equal(readFileSync(join(root,'ordinary'),'utf8'),'contained-positive');
  symlinkSync(input.canary,join(root,'outside-file'));symlinkSync('outside-file',join(root,'chain'));renameSync(join(root,'chain'),join(root,'renamed-chain'));deny('resolved-outside-append',()=>writeFileSync(join(root,'renamed-chain'),'bad',{flag:'a'}));
  symlinkSync(input.outsideDirectory,join(root,'outside-directory'));deny('resolved-outside-child',()=>writeFileSync(join(root,'outside-directory','new-child'),'bad',{flag:'wx'}));
  symlinkSync('aGeNtS.Md',join(root,'instruction-alias'));deny('fresh-protected-alias',()=>writeFileSync(join(root,'instruction-alias'),'benign-canary'));assert.equal(existsSync(join(root,'aGeNtS.Md')),false);
  deny('outside-inode-import',()=>linkSync(input.canary,join(root,'imported-inode')));deny('outside-physical-directory-import',()=>renameSync(input.outsideDirectory,join(root,'imported-directory')));
  const native=run('/bin/sh',['-c','printf native > "$1"; printf bad >> "$2"; outside=$?; printf benign > "$3"; protected=$?; printf "outside=%s protected=%s\\n" "$outside" "$protected"; test "$outside" -ne 0 && test "$protected" -ne 0','independent',join(root,'native-ordinary'),join(root,'renamed-chain'),join(root,'instruction-alias')],{});assert.equal(native.status,0,JSON.stringify(native));records.push(native);assert.equal(readFileSync(join(root,'native-ordinary'),'utf8'),'native');assert.equal(existsSync(join(root,'aGeNtS.Md')),false);
  const after=lstatSync(input.canary);assert.deepEqual({sha256:sha(readFileSync(input.canary)),inode:after.ino,links:after.nlink,directory:readdirSync(input.outsideDirectory).sort()},before);records.push({outsideUnchanged:before,inertLinksCreated:true,protectedTargetAbsent:true});
}
console.log(JSON.stringify({label,status:'PASS',records}));
