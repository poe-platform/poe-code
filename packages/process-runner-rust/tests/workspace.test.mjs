import {test}from'node:test';import assert from'node:assert/strict';import {Volume,createFsFromVolume}from'memfs';import {createMemoryFileSystem}from'@poe-code/safe-fs';import *as own from'../dist/workspace-transfer.js';import *as sdk from'../../process-runner/dist/workspace-transfer.js';
function fixture(){const local=createFsFromVolume(Volume.fromJSON({'/repo/.gitignore':'build/\n!build/\n!build/keep\n*.tmp\n!keep.tmp','/repo/.poe-code-ignore':'private/','/repo/main.txt':'original','/repo/keep.tmp':'keep','/repo/drop.tmp':'drop','/repo/build/keep':'keep','/repo/build/drop':'drop','/repo/nested/.gitignore':'*.log\n!keep.log','/repo/nested/keep.log':'keep','/repo/nested/drop.log':'drop','/repo/private/secret':'hidden','/repo/.git/config':'git'})),remote=createFsFromVolume(Volume.fromJSON({'/workspace/prior':'old'}));local.writeFileSync('/repo/binary',Buffer.from([0,255,128]));return{local,remote,env:{cwd:'/repo',uploadDir:'/upload',workspaceDir:'/workspace',fs:local.promises,remoteFs:remote.promises}};}
function snapshot(fs,root){const out={};function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=dir+'/'+entry.name;if(entry.isDirectory())visit(full);else if(entry.isFile())out[full]=fs.readFileSync(full).toString('hex');}}if(fs.existsSync(root))visit(root);return out;}
test('native transfer matches SDK filters, binary bytes, conflict refusal and remote deletion',async()=>{
 for(let round=0;round<16;round++){const results=[];for(const api of[sdk,own]){const{local,remote,env}=fixture(),warnings=[],upload=await api.uploadWorkspace(env,{uploadMaxFileMb:round%2?100:0.000005,warn:text=>warnings.push(text),workspaceExclude:round%3?[]:['nested/']});remote.writeFileSync('/workspace/main.txt','remote');remote.writeFileSync('/workspace/new.txt',Buffer.from([0,255,round]));local.writeFileSync('/repo/main.txt',round%2?'local':'original');if(remote.existsSync('/workspace/binary'))remote.unlinkSync('/workspace/binary');const download=await api.downloadWorkspace(env,{conflictPolicy:round%4?'refuse':'overwrite'});results.push({upload,warnings,download,local:snapshot(local,'/repo'),remote:snapshot(remote,'/workspace'),archive:remote.readFileSync('/upload/workspace.tar').toString('hex')});}assert.deepEqual(results[1],results[0],`round${round}`);}
});
test('native upload rollback matches SDK snapshots and keeps the original failing exception',async()=>{
 for(const failure of['mkdir','writeArchive','writeFile','backup','promote','archive']){const results=[];for(const api of[sdk,own]){const{local,remote,env}=fixture(),base=env.remoteFs,fault=new Error('injected '+failure);let failed=false;env.remoteFs={...base,mkdir:async(name,options)=>{if(!failed&&failure==='mkdir'&&name.endsWith('.upload-tmp')){failed=true;throw fault;}return base.mkdir(name,options);},writeFile:async(name,data,options)=>{if(!failed&&((failure==='writeArchive'&&name.endsWith('workspace.tar.upload-tmp'))||(failure==='writeFile'&&name.endsWith('/main.txt')))){failed=true;throw fault;}return base.writeFile(name,data,options);},rename:async(source,target)=>{if(!failed&&((failure==='backup'&&target.endsWith('.upload-backup'))||(failure==='promote'&&source.endsWith('/workspace.upload-tmp'))||(failure==='archive'&&source.endsWith('workspace.tar.upload-tmp')))){failed=true;throw fault;}return base.rename(source,target);}};await assert.rejects(api.uploadWorkspace(env,{}),error=>error===fault);results.push({local:snapshot(local,'/repo'),workspace:snapshot(remote,'/workspace'),staged:snapshot(remote,'/workspace.upload-tmp'),backup:snapshot(remote,'/workspace.upload-backup'),upload:snapshot(remote,'/upload')});}assert.deepEqual(results[1],results[0],failure);}
});
test('workspace exclusion entries preserve embedded newline as one literal pattern',async()=>{
 const outputs=[];for(const api of[sdk,own]){const{remote,env}=fixture();outputs.push({result:await api.uploadWorkspace(env,{workspaceExclude:['main\n*']}),files:snapshot(remote,'/workspace')});}assert.deepEqual(outputs[1],outputs[0]);
});
test('workspace transfer admits separate filesystem capabilities with binary conflicts',async()=>{
 const outcomes=[];
 for(const api of [sdk,own]){
  const local=createMemoryFileSystem(),remote=createMemoryFileSystem(),bytes=new Uint8Array([0,255,128,1]);
  await local.mkdir('/repo/src',{recursive:true});
  await local.writeFile('/repo/.gitignore',new TextEncoder().encode('ignored.txt\n'));
  await local.writeFile('/repo/ignored.txt',new TextEncoder().encode('skip'));
  await local.writeFile('/repo/src/data.bin',bytes);
  const env={cwd:'/repo',uploadDir:'/stage',workspaceDir:'/workspace',fs:local,remoteFs:remote};
  const upload=await api.uploadWorkspace(env,{});
  assert.equal(upload.files,2);
  assert.deepEqual(await remote.readFile('/workspace/src/data.bin'),bytes);
  await assert.rejects(remote.stat('/workspace/ignored.txt'),error=>error.code==='ENOENT');
  await remote.writeFile('/workspace/src/data.bin',new Uint8Array([3,2,1]));
  await local.writeFile('/repo/src/data.bin',new Uint8Array([9,8,7]));
  const refused=await api.downloadWorkspace(env,{conflictPolicy:'refuse'});
  assert.deepEqual(refused.conflicts,[{path:'src/data.bin',reason:'local_modified'}]);
  assert.deepEqual(await local.readFile('/repo/src/data.bin'),new Uint8Array([9,8,7]));
  const overwrite=await api.downloadWorkspace(env,{conflictPolicy:'overwrite'});
  assert.deepEqual(await local.readFile('/repo/src/data.bin'),new Uint8Array([3,2,1]));
  outcomes.push({upload,refused,overwrite,archive:Array.from(await remote.readFile('/stage/workspace.tar'))});
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});
test('workspace capability callbacks retain original byte views and Uint8Array archives',async()=>{
 const outcomes=[];
 for(const api of [sdk,own]){
  const local=createMemoryFileSystem(),remote=createMemoryFileSystem();
  const source=new Uint8Array(new Uint8Array([99,0,255,128,98]).buffer,1,3);
  const changed=new Uint8Array(new Uint8Array([99,3,2,1,98]).buffer,1,3),events=[];
  await local.mkdir('/repo');
  await local.writeFile('/repo/data.bin',source);
  const localFs=new Proxy(local,{get(target,key){
   if(key==='readFile')return async (...args)=>args[0]==='/repo/data.bin'?source:target.readFile(...args);
   if(key==='writeFile')return async (file,data,options)=>{events.push(['download',data===changed,data.constructor.name,Array.from(data)]);return target.writeFile(file,data,options);};
   return Reflect.get(target,key,target);
  }});
  const remoteFs=new Proxy(remote,{get(target,key){
   if(key==='writeFile')return async (file,data,options)=>{events.push([file.endsWith('/data.bin')?'upload':'archive',data===source,data.constructor.name]);return target.writeFile(file,data,options);};
   if(key==='readFile')return async (...args)=>args[0]==='/workspace/data.bin'?changed:target.readFile(...args);
   return Reflect.get(target,key,target);
  }});
  const env={cwd:'/repo',uploadDir:'/stage',workspaceDir:'/workspace',fs:localFs,remoteFs};
  await api.uploadWorkspace(env,{});
  await api.downloadWorkspace(env,{conflictPolicy:'overwrite'});
  assert.deepEqual(await local.readFile('/repo/data.bin'),changed);
  outcomes.push(events);
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
 assert.deepEqual(outcomes[0],[['archive',false,'Uint8Array'],['upload',true,'Uint8Array'],['download',true,'Uint8Array',[3,2,1]]]);
});
test('native and SDK reject remote and local symbolic links and missing link-check support',async()=>{
 for(const api of[sdk,own]){
  {const{remote,env}=fixture();remote.symlinkSync('/outside','/workspace/link');await assert.rejects(api.downloadWorkspace(env,{conflictPolicy:'overwrite'}),{message:'Workspace download must not follow symbolic links.'});}
  {const{local,remote,env}=fixture();local.mkdirSync('/escape');local.mkdirSync('/repo/linked');local.symlinkSync('/escape','/repo/linked/path');remote.mkdirSync('/workspace/linked/path',{recursive:true});remote.writeFileSync('/workspace/linked/path/file','remote');await assert.rejects(api.downloadWorkspace(env,{conflictPolicy:'overwrite'}),{message:'Workspace download must remain inside the local workspace.'});assert.deepEqual(local.readdirSync('/escape'),[]);}
  {const{env}=fixture();env.fs={...env.fs,lstat:undefined};await assert.rejects(api.downloadWorkspace(env,{conflictPolicy:'overwrite'}),{message:'Workspace transfer filesystem must support symbolic link checks.'});}
 }
});
