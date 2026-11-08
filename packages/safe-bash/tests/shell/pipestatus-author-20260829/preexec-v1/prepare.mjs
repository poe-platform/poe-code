import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const repo='/Users/kjopek/Workspace/safe-bash';
const own=repo+'/tests/shell/pipestatus-author-20260829/preexec-v1';
const prior=repo+'/tests/shell/pipestatus-author-20260829/corrected-v2';
const work='/private/tmp/safe-bash-pipestatus-preexec';
const k08=repo+'/tests/compatibility/bash-function-keyword-author-20260829/k08-harness-v2';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function read(filename, maximum=2097152){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.size>maximum)throw Error('PREP_TYPE_SIZE');const bytes=fs.readFileSync(filename);if(bytes.length!==stat.size)throw Error('PREP_READ');return bytes;}
function pin(filename){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.size>134217728)throw Error('PREP_PIN');const digest=createHash('sha256'),buffer=Buffer.alloc(65536),descriptor=fs.openSync(filename,'r');let bytes=0;try{for(;;){const count=fs.readSync(descriptor,buffer,0,buffer.length,null);if(!count)break;bytes+=count;digest.update(buffer.subarray(0,count));}}finally{fs.closeSync(descriptor);}if(bytes!==stat.size)throw Error('PREP_PIN_SIZE');return {path:filename,bytes,mode:stat.mode&4095,sha256:digest.digest('hex')};}
const save=(name,value)=>fs.writeFileSync(own+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const sourceBytes=read(prior+'/SEAL.json');if(hash(sourceBytes)!=='c590f60ab8f53c5988056087257e2ed8564ef0db5e256ca4a7d836fa88fce718')throw Error('PIPE_SOURCE_SEAL');
const source=JSON.parse(sourceBytes);if(source.count!==307||source.projectionTree!=='74fec4d4e26d9c0b2d27613c15af7a88cb56f628')throw Error('PIPE_MEMBERSHIP');
const manifestBytes=read(prior+'/PACKAGE.json');const manifest=JSON.parse(manifestBytes);if(manifest.count!==1010||manifest.sha256!=='6c60e2d766fa675b7972afdc0eb6f5304f99231abceff1daf5cb196b897346a5')throw Error('PIPE_PACKAGE');
const k08Bytes=read(k08+'/SEAL.json');const old=JSON.parse(k08Bytes);
fs.mkdirSync(own+'/reuse');const reuse=[];
for(const name of ['auth.mjs','profile.mjs','guard.mjs','finalization.mjs','direct-child.mjs']){
  const packet=name==='direct-child.mjs';const filename=(packet?k08:old.helperRoot)+'/'+name;const expected=(packet?old.files:old.helperPins)[name];
  const bytes=read(filename);if(bytes.length!==expected.bytes||hash(bytes)!==expected.sha256)throw Error('REUSE_BINDING '+name);
  const destination=own+'/reuse/'+name;fs.writeFileSync(destination,bytes,{flag:'wx'});reuse.push({...pin(destination),name,origin:filename,qualifiedSealSha256:hash(k08Bytes),byteExact:true});
}
const node=pin(source.compiler.executable);if(node.bytes!==112989184||node.sha256!=='5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011')throw Error('NODE_PIN');
const archive=pin(prior+'/corrected-build-artifact.tgz');if(archive.bytes!==manifest.size||archive.sha256!==manifest.sha256)throw Error('ARCHIVE_PIN');
const hostSource=source.candidate+'/dist/shell/pipestatus-host-proof.js';
const host=pin(hostSource);fs.writeFileSync(own+'/host-protocols.mjs',read(hostSource),{flag:'wx'});
const visible=JSON.parse(read(prior+'/MATRIX.json'));if(visible.visibleCases.length!==18||visible.hostIds.length!==8)throw Error('CASE_MEMBERSHIP');
const cases=[...visible.visibleCases,...visible.hostIds.map(id=>({id}))];if(new Set(cases.map(row=>row.id)).size!==26)throw Error('CASE_IDENTITIES');
const npmRoot='/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm';
const npmFiles=[],npmDirectories=[];function toolWalk(directory){for(const name of fs.readdirSync(directory).sort()){const filename=path.join(directory,name),stat=fs.lstatSync(filename);if(stat.isDirectory()){npmDirectories.push({path:filename,mode:stat.mode&4095});toolWalk(filename);}else if(stat.isSymbolicLink()){const target=fs.realpathSync(filename);if(!target.startsWith(npmRoot+'/'))throw Error('NPM_EXTERNAL_LINK');const targetPin=pin(target);npmFiles.push({kind:'link',path:filename,mode:stat.mode&4095,text:fs.readlinkSync(filename),target,targetBytes:targetPin.bytes,targetSha256:targetPin.sha256});}else npmFiles.push({kind:'file',...pin(filename)});}}toolWalk(npmRoot);
const npmVersion=JSON.parse(read(npmRoot+'/package.json')).version;
const files=['PRESEAL.md','admission.mjs','owner.mjs','outer.mjs','case-driver.mjs','prepare.mjs','controls.mjs','launch.sh','host-protocols.mjs',...reuse.map(row=>'reuse/'+row.name)].map(name=>pin(own+'/'+name));
fs.writeFileSync(own+'/BOOTSTRAP.sha256',files.map(row=>row.sha256+'  '+row.path+'\n').join(''),{flag:'wx'});
const seal={schema:'pipestatus-preexec-v1',sourceIdentity:source.sourceCommit,sourceProjection:source.projectionTree,sourceRoot:source.candidate,sources:source.sources,node,archive,packageManifest:{...pin(prior+'/PACKAGE.json')},files,reuse,host:pin(own+'/host-protocols.mjs'),driver:pin(own+'/case-driver.mjs'),owner:own+'/owner.mjs',outer:own+'/outer.mjs',actualRoot:'/private/tmp/safe-bash-pipestatus-actual-78-v1',cases,npmRoot,npmVersion,npmFiles,npmDirectories,bootstrap:pin(own+'/BOOTSTRAP.sha256'),limits:{totalMs:1800000,publicationMs:180000,caseMs:30000,installMs:120000,managedInnerChildren:79,plannedExecutionStarts:84,publicationAdminSlots:9,totalKnownStarts:93,peak:3,captureBytes:100663296,workBytes:536870912,workers:0},shippingManifestSha256:hash(sourceBytes),productExecutions:0};
save('SEAL.json',seal);save('REUSE.json',reuse);save('ROLE-GRAPH.json',{outer:['launch-shell','binary-and-manifest-shasum','bootstrap-shasum','outer-Node','owner-Node'],inner:['offline-npm',...['source-built','installed','physically-moved'].flatMap(layout=>cases.map(row=>layout+':'+row.id))],publicationAdminSlots:9,totalCeiling:93,publicExecCalls:81,contextInvokes:3,executedProductCases:0});
save('GRANT.template.json',{action:'execute-pipestatus-78-v1',sealSha256:hash(Buffer.from(JSON.stringify(seal,null,2)+'\n')),rootReceipt:'REQUIRES_FUTURE_ROOT_DURABLE_40_HEX_COMMIT',started:'REQUIRES_FUTURE_INTEGER_MS',deadline:'started+1800000'});
save('PREPARED.json',{seal:pin(own+'/SEAL.json'),node,reused:reuse.length,npmVersion,npmMembers:npmFiles.length,npmLinks:npmFiles.filter(row=>row.kind==='link').length,sourceInputs:307,packageMembers:1010,productImports:0});
console.log(JSON.stringify({sources:307,package:1010,reused:reuse.length,npmVersion,npmMembers:npmFiles.length,sealSha256:hash(read(own+'/SEAL.json')),productImports:0}));
