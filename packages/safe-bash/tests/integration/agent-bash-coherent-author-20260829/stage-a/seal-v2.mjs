import {fs,path,assert,scope,prior,sha,read,streamed,json,safe} from './common.mjs';
const started=new Date().toISOString();
try{
 const old=JSON.parse(read(path.join(scope,'../v4/PRESEAL.json'),1048576,{bytes:8922,sha256:'4911f32f621e33adf8cacd0eabbc13b0644586fc3efd36ca42abf3c85765734c'}));
 const toolsRow=old.fixtureFiles.find(row=>row.path.endsWith('/v2/TOOLSS.json'.replace('TOOLSS','TOOLS')));assert.ok(toolsRow);
 const toolsBytes=read(path.join(prior,'TOOLS.json'),1048576,toolsRow),tools=JSON.parse(toolsBytes);
 const sourceBytes=read(path.join(prior,'SOURCE.json'),1048576);assert.equal(sha(sourceBytes),'ef0b79dbd30cebec3f8b939a98928b9441947ff4be724e5031b2ee03925f26ae');const source=JSON.parse(sourceBytes);
 assert.equal(source.inputs.length,309);assert.equal(source.computedTree,'3adc676a0ab638c9788ef007e465931d65d2c6fe');
 const inspection=JSON.parse(read(path.join(scope,'INSPECTION.json'),1048576));assert.equal(inspection.toolsSha256,sha(toolsBytes));
 const manifest=inspection.objects['package.json'];assert.deepEqual(manifest.files,['dist']);assert.equal(Object.keys(manifest.dependencies??{}).length,0);
 for(const name of ['prepublish','prepare','prepublishOnly','prepack','postpack','publish','postpublish','preinstall','install','postinstall'])assert.ok(!Object.hasOwn(manifest.scripts??{},name));
 const expectedMembers=['README.md','package.json'];
 for(const row of source.inputs){safe(row.path);assert.equal(row.mode,'100644');assert.ok(!row.path.startsWith('dist/'));if(row.path.startsWith('src/')&&row.path.endsWith('.ts')){assert.ok(!row.path.endsWith('.d.ts'));const stem='dist/'+row.path.slice(4,-3);expectedMembers.push(stem+'.js',stem+'.js.map',stem+'.d.ts',stem+'.d.ts.map');}}
 expectedMembers.sort();assert.equal(expectedMembers.length,1014);
 await streamed(tools.node.path,tools.node);await streamed(tools.git.path,tools.git);
 const toolCounts={},links=[];let toolBytes=0;
 for(const [name,pack]of Object.entries(tools.packages)){
  safe(name);assert.equal(fs.realpathSync(pack.origin),pack.resolvedRoot);
  for(const row of pack.rows){safe(row.path);if(row.type==='symlink'){
   assert.equal(name,'npm');safe(row.resolvedRelative);const filename=path.join(pack.resolvedRoot,row.path);assert.ok(fs.lstatSync(filename).isSymbolicLink());assert.equal(fs.readlinkSync(filename),row.target);assert.equal(path.resolve(path.dirname(filename),row.target),path.join(pack.resolvedRoot,row.resolvedRelative));assert.equal(fs.realpathSync(filename),path.join(pack.resolvedRoot,row.resolvedRelative));const target=pack.rows.find(item=>item.path===row.resolvedRelative);assert.equal(target?.type,'file');await streamed(path.join(pack.resolvedRoot,row.resolvedRelative),target);links.push({package:name,...row});
  }else{assert.equal(row.type,'file');assert.ok(row.bytes<=16777216);await streamed(path.join(pack.resolvedRoot,row.path),row);toolBytes+=row.bytes;}}
  toolCounts[name]={version:pack.version,files:pack.rows.filter(row=>row.type==='file').length,links:pack.rows.filter(row=>row.type==='symlink').length};
 }
 assert.equal(links.length,12);assert.ok(toolBytes<134217728);
 const controlsRoot=path.join(scope,'data-controls-v2');fs.mkdirSync(controlsRoot);const controlPath=path.join(controlsRoot,'literal.json');const controlBytes=Buffer.from('{"admitted":true}\n');fs.writeFileSync(controlPath,controlBytes,{flag:'wx'});const identity={bytes:controlBytes.length,sha256:sha(controlBytes)};
 const controls=['same-buffer-literal-positive'];assert.ok(read(controlPath,64,identity).equals(controlBytes));
 for(const [name,operation]of [['wrong-size',()=>read(controlPath,64,{...identity,bytes:identity.bytes+1})],['wrong-hash',()=>read(controlPath,64,{...identity,sha256:'0'.repeat(64)})],['encoded-cap',()=>read(controlPath,identity.bytes-1,identity)],['directory',()=>read(controlsRoot,64)],['missing',()=>read(controlPath+'.missing',64)],['traversal',()=>safe('../escape')],['instruction-path',()=>safe('AGENTS.md')]]){assert.throws(operation);controls.push(name);}
 json(path.join(scope,'DATA-CONTROLS-v2.json'),{role:'NEW_STAGE_A_DATA_ONLY_NOT_INHERITED12_RERUN',controls,productExecutions:0});
 const inputs=['outer.sh','common.mjs','produce.mjs','seal-v2.mjs','PROFILE.md'].map(name=>{const body=read(path.join(scope,name),1048576);return{path:name,bytes:body.length,sha256:sha(body)};});
 const seal={role:'STAGE_A_PRODUCER_ONLY',started,finished:new Date().toISOString(),sourceTree:source.computedTree,source:{path:path.join(prior,'SOURCE.json'),bytes:sourceBytes.length,sha256:sha(sourceBytes)},tools:{path:path.join(prior,'TOOLS.json'),bytes:toolsBytes.length,sha256:sha(toolsBytes)},inputs,toolCounts,toolBytes,links,expectedMembers,lifecycleHooksAbsent:true,workRoot:'/tmp/safe-bash-coherent-stage-a-20260829-r1',bounds:{seconds:1200,childSeconds:120,knownStarts:32,peak:3,captureBytes:67108864,workingBytes:805306368,encodedPackageBytes:16777216,decodedPackageBytes:67108864,simultaneousAccountedDataBuffers:100663296},stageB:'UNRUN_NO_AUTHORITY'};
 json(path.join(scope,'PRESEAL.json'),seal);const sealed=read(path.join(scope,'PRESEAL.json'),1048576);console.log(JSON.stringify({presealSha256:sha(sealed),presealBytes:sealed.length,toolCounts,toolBytes,expectedMembers:1014,productExecutions:0}));
}catch(error){json(path.join(scope,'PREP-STOP-v2.json'),{started,error:String(error?.stack??error),productExecutions:0});process.exitCode=78;throw error;}
