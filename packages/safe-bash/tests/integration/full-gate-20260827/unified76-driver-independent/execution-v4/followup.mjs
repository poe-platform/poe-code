import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createGunzip,gunzipSync} from 'node:zlib';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';

const directory=dirname(fileURLToPath(import.meta.url)),repository=resolve(directory,'../../../../..');
const plan=JSON.parse(fs.readFileSync(join(directory,'PLAN.json'))),binding=plan.bindings;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>structuredClone(value);
const env=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>!(/^(GIT_|DYLD_|LD_)/u.test(key)||['NODE_OPTIONS','NODE_PATH'].includes(key))));
const data=join(directory,'data-followup');assert.ok(!fs.existsSync(data));fs.mkdirSync(data);process.chdir(data);
assert.equal(process.version,'v24.11.1');assert.equal(fs.realpathSync(process.execPath),binding.node);
const report={schema:'unified76-independent-execution-followup/v4.1',started:new Date().toISOString(),bindings:binding,firstAttempt:'3856519a',groups:[],sources:[],commands:[],trace:[],wholeGateLaunched:false,rootRelease:'HOLD'};
const raw=[],staged=[],preserved=Object.fromEntries(['PLAN.json','review.mjs','RESULTS.json','RAW-COMMANDS.ndjson','EXECUTION.txt','FOLLOWUP-PLAN.json'].map(name=>[name,sha(fs.readFileSync(join(directory,name)))]));
const command=(executable,args,options={})=>{
  const answer=childProcess.spawnSync(executable,args,{cwd:data,env:{...env(),HOME:data,TMPDIR:data},encoding:null,timeout:240000,maxBuffer:8388608,...options});
  const stdout=Buffer.from(answer.stdout??''),stderr=Buffer.from(answer.stderr??'');
  const receipt={executable,args,cwd:options.cwd??data,status:answer.status,signal:answer.signal,error:answer.error?.message,stdoutBytes:stdout.length,stderrBytes:stderr.length,stdoutSha256:sha(stdout),stderrSha256:sha(stderr)};
  report.commands.push(receipt);raw.push({...receipt,stdout:stdout.length<=16384?stdout.toString():undefined,stderr:stderr.length<=16384?stderr.toString():undefined});return{...receipt,stdout,stderr};
};
const git=(args,cwd=repository)=>{const answer=command(binding.git,['--no-replace-objects',...args],{cwd});assert.equal(answer.status,0,answer.stderr.toString());assert.equal(answer.signal,null);return answer.stdout;};
const blob=(path,revision=binding.candidate)=>{const size=Number(git(['cat-file','-s',revision+':'+path]));assert.ok(size<=8388608);const bytes=git(['show',revision+':'+path]);assert.equal(bytes.length,size);return bytes;};
const seal=JSON.parse(blob(binding.prefix+'DRIVER.json',binding.driver));
for(const name of [...Object.keys(seal.files),'DRIVER.json']){const bytes=blob(binding.prefix+name,binding.driver),path=join(directory,name);assert.ok(!fs.existsSync(path));if(name!=='DRIVER.json')assert.equal(sha(bytes),seal.files[name]);else assert.equal(sha(bytes),binding.driverFileSha256);fs.writeFileSync(path,bytes,{flag:'wx'});staged.push(path);report.sources.push({name,sha256:sha(bytes),revision:binding.driver,path:binding.prefix+name});}
const allowed=new Map(report.sources.map(source=>[join(directory,source.name),source.sha256]));
const originalSpawn=childProcess.spawn;
childProcess.spawn=function(executable,args,options){assert.ok([binding.git,binding.node,'/bin/ps'].includes(executable));assert.ok(!args.some(argument=>/\b(worker|execute)\.mjs\b/u.test(String(argument))));return originalSpawn(executable,args,options);};syncBuiltinESMExports();
const hooks=registerHooks({resolve(specifier,context,next){const resolved=next(specifier,context);if(!resolved.url.startsWith('node:')){const path=fs.realpathSync(fileURLToPath(resolved.url));assert.ok(allowed.has(path),'No live module fallback');assert.ok(!['execute.mjs','public.mjs','controls.mjs'].includes(relative(directory,path)),'Full-gate load denied');assert.equal(sha(fs.readFileSync(path)),allowed.get(path));report.trace.push({stage:'resolve',specifier,parent:context.parentURL,path,sha256:allowed.get(path)});}return resolved;},load(url,context,next){if(!url.startsWith('node:')){const path=fs.realpathSync(fileURLToPath(url));assert.ok(allowed.has(path));assert.ok(!['execute.mjs','public.mjs','controls.mjs'].includes(relative(directory,path)));assert.equal(sha(fs.readFileSync(path)),allowed.get(path));report.trace.push({stage:'load',path,sha256:allowed.get(path)});}return next(url,context);}});
const module=name=>import(pathToFileURL(join(directory,name)));
const fresh=name=>{const path=join(data,name);fs.mkdirSync(path,{recursive:true});return path;};
const entry=(path,content,mode='100644')=>({path,mode,bytes:Buffer.byteLength(content),blob:createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex')});
let group,inventory;
const check=async(name,operation)=>{try{group.controls.push({name,status:'PASS',detail:await operation()});}catch(error){group.controls.push({name,status:'FAIL',error:String(error).slice(0,4000),stack:error.stack?.slice(0,8000)});}};
const reject=async(name,operation)=>check(name,async()=>{try{await operation();}catch(error){return{rejected:true,error:String(error).slice(0,2000)};}assert.fail('Unexpected acceptance');});
const run=async(id,operation)=>{group={id,controls:[]};report.groups.push(group);console.log(id+' FOLLOWUP START');try{await operation();}catch(error){group.controls.push({name:'infrastructure',status:'FAIL',error:String(error),stack:error.stack});}group.status=group.controls.some(control=>control.status==='FAIL')?'FAIL':'PASS';console.log(id+' FOLLOWUP '+group.status);};
try{
  inventory=await module('inventory.mjs');const external=await module('external-admission.mjs'),identity=await module('external.mjs'),transport=await module('transport.mjs'),policy=await module('policy.mjs');
  await run('A04',async()=>{
    await check('fresh-environment actual readable tool/dependency verification',async()=>{report.external=await external.verifyExternal(env());return report.external;});
    const receipt=external.externalReceipt();report.externalOrigins={tools:receipt.report.tools,directories:Object.fromEntries(Object.entries(receipt.report.directories).map(([name,tree])=>[name,{origin:tree.origin,root:tree.root,bytes:tree.bytes,entries:tree.entries.length,sha256:tree.sha256}]))};
    await check('exact11 qualified metadata, not library file hashes',()=>external.validateSystemBoundary(receipt.report));
  });
  await run('A06',async()=>{
    const root=fresh('archive');fs.writeFileSync(join(root,'input.mjs'),'fixed');fs.symlinkSync('input.mjs',join(root,'link'));const expected=[entry('input.mjs','fixed'),entry('link','input.mjs','120000')];
    await check('regular source and contained declared link',()=>inventory.verifyArchive(root,expected));
    fs.unlinkSync(join(root,'input.mjs'));fs.symlinkSync('link',join(root,'input.mjs'));await reject('source swapped to symlink without live fallback',()=>inventory.verifyArchive(root,expected));fs.unlinkSync(join(root,'input.mjs'));fs.writeFileSync(join(root,'input.mjs'),'fixed');
    fs.unlinkSync(join(root,'link'));fs.symlinkSync('../archive/input.mjs',join(root,'link'));await reject('lexical escaping link target',()=>inventory.verifyArchive(root,[expected[0],entry('link','../archive/input.mjs','120000')]));
    fs.unlinkSync(join(root,'link'));fs.symlinkSync('input.mjs',join(root,'link'));fs.writeFileSync(join(root,'addition'),'extra');await reject('undeclared file addition',()=>inventory.verifyArchive(root,expected));
  });
  await run('A08',async()=>{
    const root=fresh('narrow-read'),outside=join(data,'read-sentinel');fs.writeFileSync(outside,'outside explicitly allowed root');fs.writeFileSync(join(root,'allowed'),'inside');
    for(const[name,path,expected]of [['positive',join(root,'allowed'),0],['negative',outside,1]])await check('actual narrower permission '+name,()=>{const answer=command('/usr/bin/env',['-u','NODE_OPTIONS',binding.node,'--permission','--allow-fs-read='+root,'-e',`require('node:fs').readFileSync(${JSON.stringify(path)});console.log('READ_ALLOWED')`]);assert.equal(answer.status,expected,answer.stderr.toString());if(expected)assert.match(answer.stderr.toString(),/ERR_ACCESS_DENIED/u);return{status:answer.status,stdout:answer.stdout.toString(),stderr:answer.stderr.toString(),parentPermissionInheritanceRemoved:true};});
  });
  let tiny,commit,entries;
  await run('A12',async()=>{
    tiny=fresh('tiny-git');git(['init','--quiet',tiny]);fs.writeFileSync(join(tiny,'helper.mjs'),'export const marker = 76;\n');fs.writeFileSync(join(tiny,'golden'),'golden\n');fs.symlinkSync('helper.mjs',join(tiny,'link'));git(['add','--','helper.mjs','golden','link'],tiny);git(['-c','user.name=Independent bounded fixture','-c','user.email=bounded@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Tiny owned transport'],tiny);commit=git(['rev-parse','HEAD'],tiny).toString().trim();entries=git(['ls-tree','-rlz','HEAD'],tiny).toString().split('\0').filter(Boolean).map(line=>{const match=/^(\d+) blob ([a-f0-9]{40})\s+(\d+)\t(.+)$/u.exec(line);return{path:match[4],mode:match[1],blob:match[2],bytes:Number(match[3])};});const bounds={...policy.BOUNDS,archiveEntries:entries.length,archiveBytes:entries.reduce((sum,item)=>sum+item.bytes,0)};
    await check('actual tiny streamed Git blob transport and archive verification',async()=>{const destination=fresh('extracted'),receipt=await transport.extractCommitted({git:binding.git,repository:tiny,candidate:commit,entries,destination,environment:env(),bounds});assert.ok(receipt.transferBytes<=1048576);return{receipt,verified:await inventory.verifyArchive(destination,entries)};});
    await check('actual tiny streamed reachable Git history',async()=>{const destination=fresh('reachable');git(['init','--quiet',destination]);const receipt=await transport.transferHistory({git:binding.git,repository:tiny,candidate:commit,destination,environment:env()});assert.ok(receipt.bytes<=8388608);assert.equal(git(['cat-file','-t',commit],destination).toString().trim(),'commit');return receipt;});
    for(const mutation of ['wrong-size','missing-object'])await reject('actual transport '+mutation,()=>{const changed=clone(entries);if(mutation==='wrong-size')changed[0].bytes++;else changed[0].blob='0'.repeat(40);return transport.extractCommitted({git:binding.git,repository:tiny,candidate:commit,entries:changed,destination:fresh(mutation),environment:env(),bounds:{...bounds,archiveBytes:changed.reduce((sum,item)=>sum+item.bytes,0)}});});await reject('pre-growth charge ceiling',()=>policy.enforceCharge(64,1,64));
  });
  await run('A13',async()=>{
    for(const path of ['../escape','/absolute','.git/config','a/../b','a\\b'])await reject('path refusal '+path,()=>transport.validateEntries([entry(path,'x')],{archiveEntries:1,archiveBytes:1}));await reject('duplicate',()=>transport.validateEntries([entry('a','x'),entry('a','x')],{archiveEntries:2,archiveBytes:2}));await reject('link ancestor',()=>transport.validateEntries([entry('a','x','120000'),entry('a/b','x')],{archiveEntries:2,archiveBytes:2}));
    fs.symlinkSync('../outside',join(tiny,'escape'));git(['add','--','escape'],tiny);const object=git(['rev-parse',':escape'],tiny).toString().trim(),item={...entry('escape','../outside','120000'),blob:object};
    await reject('actual escaped link target extraction',()=>transport.extractCommitted({git:binding.git,repository:tiny,candidate:commit,entries:[item],destination:fresh('escape-output'),environment:env(),bounds:{archiveEntries:1,archiveBytes:item.bytes}}));await check('no escaped destination effect',()=>assert.equal(fs.existsSync(join(data,'outside')),false));
  });
  await run('A15',async()=>{
    const receipt=external.externalReceipt();await check('actual51 qualified native assets and61 readable tool identities',()=>{assert.ok(report.external?.readableBindingsVerified);assert.equal(report.external.native,51);assert.equal(report.external.tools,61);return{assets:receipt.report.native.assets,systemBoundary:report.external.systemBoundary,semanticParityClaim:false};});await reject('absent required tool is prerequisite failure',()=>identity.fileIdentity(join(data,'absent-tool')));await reject('wrong readable tool hash',async()=>assert.deepEqual(await identity.fileIdentity(binding.node),{...receipt.report.tools.find(tool=>tool.origin===binding.node),sha256:'0'.repeat(64)}));
  });
  await run('A20',async()=>{
    const before=await inventory.capture(data),originalArgv=process.argv;process.argv=[binding.node,join(directory,'run.mjs'),'--run'];const launcher=await module('run.mjs');await module('worker.mjs');process.argv=originalArgv;
    await check('actual inert run/worker imports',async()=>assert.deepEqual(inventory.compare(before,await inventory.capture(data)),[]));
    await check('actual unreleased --run reaches missing release and no product',async()=>{const injected=process.env.NODE_OPTIONS;delete process.env.NODE_OPTIONS;let error;try{await launcher.main(['--candidate',binding.candidate,'--run','/tmp/full-gate-unified76-independent-never-created','--release',join(data,'NO-RELEASE.json'),'--committed-archive']);}catch(observed){error=observed;}finally{if(injected!==undefined)process.env.NODE_OPTIONS=injected;else delete process.env.NODE_OPTIONS;}assert.ok(error);assert.equal(error.code,'ENOENT',String(error));assert.match(error.message,/NO-RELEASE/u);assert.equal(fs.existsSync('/tmp/full-gate-unified76-independent-never-created'),false);assert.ok(!report.trace.some(record=>record.path===join(directory,'execute.mjs')));return{error:String(error),reviewInheritedOptionsRemoved:injected??null,workerOrProductStarted:false};});
  });
  await run('A11',async()=>{
    const encoded=blob(binding.prefix+'evidence/RAW.json.gz.base64',binding.evidence);assert.equal(sha(encoded),'be769e035e1791b1f5238c0f379f12720f940c7e0b601d27bb436314bb61e032');const decoded=gunzipSync(Buffer.from(encoded.toString().trim(),'base64'),{maxOutputLength:16777216});assert.equal(sha(decoded),'616e2e21a01ea47d0e78b9b6d6d86853e47b6082629e28b521e5fea3dab08edd');const packet=JSON.parse(decoded);
    const record=name=>{const bytes=Buffer.from(packet[name].base64,'base64');assert.equal(bytes.length,packet[name].bytes);assert.equal(sha(bytes),packet[name].sha256);return JSON.parse(bytes);};
    for(const prefix of ['fixtures-initial','format-completion'])await check('packet-declared complete c109 tarball '+prefix,async()=>{
      const evidence=record(prefix+'/REPORT.json'),pack=record(prefix+'/pack.stdout')[0],command=evidence.commands.find(item=>item.label==='pack');assert.equal(evidence.candidate,binding.candidate);assert.equal(evidence.packageSha256,binding.packSha256);const destination=command.args[command.args.indexOf('--pack-destination')+1],path=join(destination,pack.filename);assert.ok(fs.lstatSync(path).isFile());const physical=fs.realpathSync(path);const compressedHash=createHash('sha256');let compressedBytes=0;for await(const chunk of fs.createReadStream(path,{highWaterMark:65536})){compressedHash.update(chunk);compressedBytes+=chunk.length;}assert.equal(compressedHash.digest('hex'),binding.packSha256);
      const members=[];let pending=Buffer.alloc(0),remaining=0,padding=0,active,decodedBytes=0,packageJson;
      for await(const chunk of fs.createReadStream(path,{highWaterMark:65536}).pipe(createGunzip())){
        decodedBytes+=chunk.length;assert.ok(decodedBytes<=33554432);pending=Buffer.concat([pending,chunk]);assert.ok(pending.length<=131072);
        while(pending.length){
          if(remaining){const count=Math.min(remaining,pending.length),bytes=pending.subarray(0,count);active.digest.update(bytes);if(active.name==='package/package.json'){assert.ok(active.size<=65536);active.parts.push(Buffer.from(bytes));}remaining-=count;pending=pending.subarray(count);if(!remaining){const digest=active.digest.digest('hex');members.push({path:active.name,bytes:active.size,type:active.type,sha256:digest});if(active.name==='package/package.json')packageJson=JSON.parse(Buffer.concat(active.parts));}continue;}
          if(padding){const count=Math.min(padding,pending.length);padding-=count;pending=pending.subarray(count);continue;}
          if(pending.length<512)break;const header=pending.subarray(0,512);pending=pending.subarray(512);if(header.every(byte=>byte===0))continue;
          const text=(start,length)=>header.subarray(start,start+length).toString().split('\0')[0],prefix=text(345,155),name=(prefix?prefix+'/':'')+text(0,100),size=Number.parseInt(text(124,12).trim()||'0',8),type=text(156,1);assert.ok(Number.isSafeInteger(size)&&size>=0);assert.ok(name.startsWith('package/')&&!name.split('/').includes('..'));assert.ok(['','0','5'].includes(type),'Unexpected tar extension requires separate review');remaining=size;padding=(512-size%512)%512;active={name,size,type,digest:createHash('sha256'),parts:[]};if(!remaining)members.push({path:name,bytes:0,type,sha256:sha('')});
        }
      }
      assert.equal(remaining,0);assert.equal(padding,0);assert.equal(pending.length,0);assert.equal(packageJson.name,'virtual-bash');assert.deepEqual(packageJson.dependencies??{},{});assert.ok(members.some(member=>member.path==='package/dist/index.js'));assert.ok(members.some(member=>member.path==='package/dist/index.d.ts'));assert.equal(members.length,pack.files.length);assert.equal(new Set(members.map(member=>member.path)).size,members.length);assert.deepEqual(members.map(member=>({path:member.path.slice(8),size:member.bytes})).sort((left,right)=>left.path.localeCompare(right.path)),pack.files.map(member=>({path:member.path,size:member.size})).sort((left,right)=>left.path.localeCompare(right.path)));
      return{path,physical,compressedBytes,sha256:binding.packSha256,decodedBytes,memberCount:members.length,members,packageName:packageJson.name,packageJsonSha256:members.find(member=>member.path==='package/package.json').sha256,declaredBuild:evidence.commands.filter(item=>item.label==='build'),qualification:'Actual complete artifact hash/listing independently checked; original build commands/status remain author evidence, not independent reproduction'};
    });
  });
}catch(error){report.infrastructureError={error:String(error),stack:error.stack};}
finally{
  hooks.deregister();childProcess.spawn=originalSpawn;syncBuiltinESMExports();for(const file of staged){assert.equal(sha(fs.readFileSync(file)),allowed.get(file));fs.unlinkSync(file);}for(const[name,digest]of Object.entries(preserved))assert.equal(sha(fs.readFileSync(join(directory,name))),digest);
  report.dataBeforeCleanup=await inventory.capture(data);assert.ok(report.dataBeforeCleanup.entries.reduce((sum,item)=>sum+(item.bytes??0),0)<=67108864);process.chdir(repository);fs.rmSync(data,{recursive:true});report.ownedTemporaryTreeRemoved=!fs.existsSync(data);report.preserved=preserved;report.finished=new Date().toISOString();report.summary=Object.fromEntries(['PASS','FAIL'].map(status=>[status,report.groups.filter(group=>group.status===status).length]));const rawText=raw.map(item=>JSON.stringify(item)+'\n').join('');assert.ok(Buffer.byteLength(rawText)<=33554432);fs.writeFileSync(join(directory,'FOLLOWUP-RAW.ndjson'),rawText,{flag:'wx'});fs.writeFileSync(join(directory,'FOLLOWUP-RESULTS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
}
