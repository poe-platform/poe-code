import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {Owner,identity,tag} from '../../agent-bash-coherent-author-20260829/admin-owner-r1/tracked-owner.mjs';
import {admitFile,deriveHostMembers} from '../producer-binding-r3/admission.mjs';
import {verifyRetiredTrace} from '../../agent-bash-coherent-b2-preflight-20260829/completion-r8/staged/new/trace.mjs';
import {unpackVerified} from '../../agent-bash-coherent-b2-preflight-20260829/completion-r8/staged/new/tar.mjs';
import {limits} from './policy.mjs';
import {ids,layouts} from '../contract.mjs';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export async function run(packet,grant,times){
  const binding=JSON.parse(admitFile(packet.binding,4194304));
  assert.equal(process.umask(),0o077);assert(!fs.existsSync(packet.workRoot));assert(!fs.existsSync(packet.evidenceRoot));
  const toolData=JSON.parse(admitFile(binding.tools,1048576));
  const node={path:toolData.node.path,bytes:toolData.node.size,sha256:toolData.node.sha256};assert.deepEqual(identity(node.path,134217728),node);
  for(const row of toolData.npm.rows){const filename=path.join(toolData.npm.root,row.path);if(row.kind==='file')admitFile({path:filename,bytes:row.size,sha256:row.sha256},16777216);else{assert.equal(row.kind,'symlink');assert.equal(fs.readlinkSync(filename),row.target);}}
  fs.mkdirSync(packet.workRoot,{mode:0o700});for(const name of ['raw','home','tmp','cache','input','bindings','traces','results'])fs.mkdirSync(path.join(packet.workRoot,name),{mode:0o700});
  const env={PATH:path.dirname(node.path),HOME:path.join(packet.workRoot,'home'),TMPDIR:path.join(packet.workRoot,'tmp'),TMP:path.join(packet.workRoot,'tmp'),TEMP:path.join(packet.workRoot,'tmp'),LANG:'C',LC_ALL:'C',TZ:'UTC',NODE_OPTIONS:'',NODE_PATH:'',NPM_CONFIG_OFFLINE:'true',NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false',NPM_CONFIG_UPDATE_NOTIFIER:'false',NPM_CONFIG_USERCONFIG:path.join(packet.workRoot,'home/user.npmrc'),NPM_CONFIG_GLOBALCONFIG:path.join(packet.workRoot,'home/global.npmrc')};
  const owner=new Owner({raw:path.join(packet.workRoot,'raw'),cwd:packet.repoRoot,env,tools:[node],wallMs:times.deadline-Date.now(),reserveMs:180000,cleanupMs:30000,maxStarts:40,peak:3,captureLimit:limits.captureBytes-8388608-3145728-8192,metadataLimit:8388608,tailBytes:1048576});
  const results=[];let primaryPresent=false,primary;const secondary=[];
  function put(filename,body,mode=0o600){const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);assert(bytes.length<=16777216);fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});const fd=fs.openSync(filename,'wx',mode);try{let offset=0;while(offset<bytes.length){const count=fs.writeSync(fd,bytes,offset,bytes.length-offset);assert(count>0);offset+=count;}}finally{fs.closeSync(fd);}return {path:filename,bytes:bytes.length,sha256:sha(bytes)};}
  function sample(){let bytes=0,entries=0;function walk(folder){for(const name of fs.readdirSync(folder)){assert(++entries<=32768);const filename=path.join(folder,name),stat=fs.lstatSync(filename);assert(!stat.isSymbolicLink(),'unexpected owned symlink');if(stat.isDirectory())walk(filename);else{assert(stat.isFile());bytes+=stat.size;assert(bytes<=limits.workBytes,'sampled logical work exceeded');}}}walk(packet.workRoot);if(fs.existsSync(packet.evidenceRoot))walk(packet.evidenceRoot);return {bytes,entries,quiescent:owner.active.size===0,peakClaim:false};}
  function inventory(packageRoot,installed){const expected=deriveHostMembers(binding.members,process.umask(),installed);const paths=[];function walk(folder){for(const name of fs.readdirSync(folder)){const filename=path.join(folder,name),stat=fs.lstatSync(filename);assert(!stat.isSymbolicLink());if(stat.isDirectory())walk(filename);else{assert(stat.isFile());paths.push(path.relative(packageRoot,filename));}}}walk(packageRoot);assert.deepEqual(paths.sort(),expected.map(row=>row.path).sort());for(const row of expected){const filename=path.join(packageRoot,row.path);admitFile({path:filename,bytes:row.bytes,sha256:row.sha256},16777216);assert.equal(fs.statSync(filename).mode&0o777,row.mode);}return expected;}
  async function child(role,args,environment,cwd){const prior=owner.config.env,priorCwd=owner.config.cwd;try{owner.config.env=environment;owner.config.cwd=cwd;const result=await owner.run(role,node.path,args,90000);assert.equal(result.faults.primaryPresent,false,'child retirement/capture fault');assert.equal(result.row.exitCode,0,'child nonzero retained');assert(result.row.exitObserved&&result.row.closeObserved&&result.row.stdoutEnd&&result.row.stderrEnd);return result;}finally{owner.config.env=prior;owner.config.cwd=priorCwd;}}
  try{
    owner.persist(path.join(packet.workRoot,'ACTIVATION.json'),{grant,times,pid:process.pid,profile:limits});
    put(env.NPM_CONFIG_USERCONFIG,'');put(env.NPM_CONFIG_GLOBALCONFIG,'');
    const stagedPath=filename=>path.join(packet.workRoot,'stage',path.relative(packet.repoRoot,filename));
    for(const row of packet.consumerFiles)put(stagedPath(row.path),admitFile(row,4194304));
    const stagedFixture=put(path.join(packet.workRoot,'input/neutral.json'),admitFile(binding.fixture,1048576));
    const stagedScalar=put(path.join(packet.workRoot,'input/scalar.json'),admitFile(binding.scalarRows,1048576));
    const archive=admitFile(binding.archive,1048576);unpackVerified(archive,binding.members);put(path.join(packet.workRoot,'input/product.tgz'),archive);
    const sourcePackage=path.join(packet.workRoot,'source-built/node_modules/virtual-bash');
    for(const row of binding.members){assert.equal(row.mode,0o644);put(path.join(sourcePackage,row.path),admitFile({path:path.join(binding.sourceRoot,row.path),bytes:row.bytes,sha256:row.sha256},16777216),row.mode);fs.chmodSync(path.join(sourcePackage,row.path),row.mode);}
    inventory(sourcePackage,false);const metadata=JSON.parse(admitFile({path:path.join(sourcePackage,'package.json'),...binding.members.find(row=>row.path==='package.json'),path:path.join(sourcePackage,'package.json')},1048576));
    for(const hook of ['preinstall','install','postinstall','prepare'])assert.equal(metadata.scripts?.[hook],undefined);
    const installed=path.join(packet.workRoot,'installed');fs.mkdirSync(installed,{mode:0o700});put(path.join(installed,'package.json'),'{"private":true,"type":"module"}\n');sample();
    const permissions=['--experimental-permission',`--allow-fs-read=${packet.workRoot}`,`--allow-fs-read=${toolData.npm.root}`,`--allow-fs-read=${node.path}`,`--allow-fs-write=${packet.workRoot}`];
    await child('offline-install',[...permissions,binding.npm,'install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--cache',path.join(packet.workRoot,'cache'),'--prefix',installed,path.join(packet.workRoot,'input/product.tgz')],env,installed);
    inventory(path.join(installed,'node_modules/virtual-bash'),true);owner.persist(path.join(packet.workRoot,'CACHE-QUIESCENT.json'),sample());
    for(const layout of layouts){
      assert(Date.now()+limits.layoutMs<=times.activeEnd,'layout inclusive headroom');
      if(layout==='physically-moved'){const before=fs.statSync(path.join(installed,'node_modules/virtual-bash'));fs.renameSync(installed,path.join(packet.workRoot,'physically-moved'));const after=fs.statSync(path.join(packet.workRoot,'physically-moved/node_modules/virtual-bash'));assert.equal(after.dev,before.dev);assert.equal(after.ino,before.ino);owner.persist(path.join(packet.workRoot,'MOVE.json'),{before:{dev:before.dev,ino:before.ino},after:{dev:after.dev,ino:after.ino},renameObserved:true});}
      const packageRoot=layout==='source-built'?sourcePackage:path.join(packet.workRoot,layout,'node_modules/virtual-bash');inventory(packageRoot,layout!=='source-built');
      const trace=path.join(packet.workRoot,'traces',layout+'.jsonl'),workerTrace=path.join(packet.workRoot,'traces',layout+'.workers.jsonl');
      const members=binding.members.filter(row=>row.path.endsWith('.js')).map(row=>({...row,absolute:path.join(packageRoot,row.path)}));
      for(const row of packet.consumerFiles)members.push({path:row.path,absolute:stagedPath(row.path),bytes:row.bytes,sha256:row.sha256});
      const manifest=put(path.join(packet.workRoot,'bindings',layout+'.json'),JSON.stringify({packageRoot,members,trace}));
      const config=put(path.join(packet.workRoot,'bindings',layout+'.config.json'),JSON.stringify({binding:manifest,fixture:stagedFixture,scalar:stagedScalar,layout,result:path.join(packet.workRoot,'results',layout+'.json'),activeEnd:Math.min(times.activeEnd,Date.now()+90000)}));
      const resourceEnv={...env,PUBLIC_BINDING:manifest.path,PUBLIC_BINDING_BYTES:String(manifest.bytes),PUBLIC_BINDING_SHA256:manifest.sha256,RESOURCE_LOG:workerTrace,RESOURCE_ALLOWANCE:'0'};
      const outcome=await child('smoke-'+layout,[...permissions,'--allow-worker','--loader',pathToFileURL(stagedPath(packet.loader)).href,'--import',pathToFileURL(stagedPath(packet.workerGuard)).href,stagedPath(packet.entry),config.path,String(config.bytes),config.sha256],resourceEnv,path.join(packet.workRoot,layout));
      const retired={exited:outcome.row.exitObserved,closed:outcome.row.closeObserved};const loaded=verifyRetiredTrace(trace,retired),workers=verifyRetiredTrace(workerTrace,retired);
      assert(workers.records.some(row=>row.kind==='before-exit'&&row.attempts===0&&row.created===0));
      const resultPath=path.join(packet.workRoot,'results',layout+'.json'),stat=fs.lstatSync(resultPath);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1048576);const bytes=fs.readFileSync(resultPath);const record={path:resultPath,bytes:bytes.length,sha256:sha(bytes)};owner.persist(resultPath+'.identity.json',record);const result=JSON.parse(bytes);assert.equal(result.primaryPresent,false);assert.equal(result.registeredShellDisposalCompleted,true);assert.deepEqual(result.rows.map(row=>row.id),ids);
      results.push({layout,result,loaded:loaded.records.length,workers,retirement:outcome.row});inventory(packageRoot,layout!=='source-built');sample();
    }
  }catch(reason){primaryPresent=true;primary=reason;}
  finally{
    owner.terminal=true;
    try{assert.equal(owner.active.size,0,'known unretired child');sample();for(const row of packet.files)admitFile(row,4194304);admitFile(binding.archive,1048576);}catch(reason){if(!primaryPresent){primaryPresent=true;primary=reason;}else secondary.push(reason);}
    const terminal={schema:'FINAL_SMOKE_TERMINAL_R4',primaryPresent,...(primaryPresent?{primary:tag(primary)}:{}),secondary:secondary.map(tag),results,known:owner.snapshot(),ownerExit:'PENDING_EXTERNAL_OBSERVATION',sourceBuiltIsProducerCopy:true,wholeCampaignAcceptance:false,perCaseDeadline:false,layoutBudgetIncludesRetirement:true};
    owner.persist(path.join(packet.workRoot,'TERMINAL.json'),terminal);
    if(Date.now()>=times.deadline)throw new Error('inclusive publication deadline');
    fs.mkdirSync(packet.evidenceRoot,{mode:0o700});
    for(const folder of ['raw','results','traces','bindings']){const destination=path.join(packet.evidenceRoot,folder);fs.mkdirSync(destination,{mode:0o700});for(const name of fs.readdirSync(path.join(packet.workRoot,folder))){const source=path.join(packet.workRoot,folder,name),stat=fs.lstatSync(source);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limits.captureBytes);put(path.join(destination,name),fs.readFileSync(source));}}
    for(const name of ['ACTIVATION.json','TERMINAL.json','CACHE-QUIESCENT.json','MOVE.json']){const source=path.join(packet.workRoot,name);if(fs.existsSync(source))put(path.join(packet.evidenceRoot,name),fs.readFileSync(source));}
    owner.persist(path.join(packet.evidenceRoot,'PUBLICATION.json'),{status:'DATA_PUBLICATION_ONLY',known:owner.snapshot(),ownerExit:'PENDING_EXTERNAL_OBSERVATION',gitCommit:'NOT_PERFORMED',deadline:times.deadline,work:sample()});
  }
  if(primaryPresent)throw primary;
}
