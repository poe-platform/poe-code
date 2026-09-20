import {test}from'node:test';import assert from'node:assert/strict';
import * as own from'../dist/index.js';import * as sdk from'../../agent-hook-config/dist/index.js';
test('native hook catalog and rules match current SDK aliases and independent config copies',()=>{
 assert.deepEqual(own.supportedHookAgents,sdk.supportedHookAgents);assert.ok(Object.isFrozen(own.supportedHookAgents));
 for(const input of ['claude',' CLAUDE ','codex','CoDeX','poe-agent','missing','constructor','\ud800'])assert.deepEqual(own.resolveAgentSupport(input),sdk.resolveAgentSupport(input));
 const first=own.getAgentConfig('claude');first.supportedEvents.push('tampered');assert.deepEqual(own.getAgentConfig('claude'),sdk.getAgentConfig('claude'));
 for(const from of ['claude','codex'])for(const to of ['CoDeX','claude']){assert.deepEqual(own.getEventMappings(from,to),sdk.getEventMappings(from,to));assert.deepEqual(own.getPlaceholderRewrites(from,to),sdk.getPlaceholderRewrites(from,to));assert.equal(own.isTransformSupported(from,to),sdk.isTransformSupported(from,to));}
 for(const to of ['claude','codex'])assert.deepEqual(own.getHandlerTypeRules(to),sdk.getHandlerTypeRules(to));
});
test('native transforms preserve original drop references and finite or nonfinite timeout fields',()=>{
 const opaque=()=>true,sources=[{event:'SessionEnd',handler:{type:'command',command:'run',opaque}},{event:'Stop',handler:{type:'command',command:'${CLAUDE_PROJECT_DIR}',timeout:Infinity}},{event:'PreToolUse',matcher:'Bash',handler:{type:'command',command:'run',args:['${CLAUDE_PLUGIN_ROOT}','\ud800']}}];
 const result=own.transformHooks(sources,'claude','codex',{runId:'round'});assert.deepEqual(result,sdk.transformHooks(sources,'claude','codex',{runId:'round'}));assert.equal(result.drops[0].source,sources[0]);
});

test('native reader distinguishes absent and explicitly null matcher values without losing handler metadata',async()=>{
 const {fs,vol}=await import('memfs');const builtin=await import('node:fs');const {syncBuiltinESMExports}=await import('node:module');
 const original={lstatSync:builtin.default.lstatSync,readFileSync:builtin.default.readFileSync};
 try{
  Object.assign(builtin.default,{lstatSync:fs.lstatSync,readFileSync:fs.readFileSync});syncBuiltinESMExports();
  vol.fromJSON({'/repo/.claude/settings.json':JSON.stringify({hooks:{Stop:[{hooks:[{type:'http',url:'https://example.test',headers:{key:'value'},once:true}]},{matcher:null,hooks:[{type:'command',command:'go'}]}]}})},'/');
  assert.deepEqual(own.readClaudeHooks('/repo','/home',{scope:'project'}),sdk.readClaudeHooks('/repo','/home',{scope:'project'}));
 }finally{Object.assign(builtin.default,original);syncBuiltinESMExports();vol.reset();}
});

test('native transform retains all timeout numbers, UTF16 text and ignored dropped metadata',()=>{
 for(const timeout of [NaN,Infinity,-Infinity,-0,0,1.5]){
  const source=[{event:'Stop',matcher:'\ud800\u0000😀',handler:{type:'command',command:'echo \udc00\u0000😀 ${CLAUDE_PROJECT_DIR}',args:['\ud800','😀',''],statusMessage:'\udc00',timeout}},{event:'SessionEnd',handler:{type:'agent',extra:Symbol('ignored')}}];
  assert.deepEqual(own.transformHooks(source,'claude','codex',{runId:'\ud800'}),sdk.transformHooks(source,'claude','codex',{runId:'\ud800'}));
 }
});

test('native lifecycle matches SDK rollback ownership and byte output over repeated in-memory bridge rounds',async()=>{
 const {fs,vol}=await import('memfs'),builtin=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module');
 const {setGitDirRunnerForTest}=await import('../dist/skill/testing.js');
 const keys=['lstatSync','readFileSync','writeFileSync','mkdirSync','renameSync','unlinkSync','readlinkSync','symlinkSync','rmdirSync','rmSync'];const original=Object.fromEntries(keys.map(key=>[key,builtin.default[key]]));
 const restoreOwn=setGitDirRunnerForTest(()=>'/repo/.git'),restoreSdk=(await import('../../agent-skill-config/dist/index.js')).setGitDirRunnerForTest(()=>'/repo/.git');
 try{
  for(const key of keys)builtin.default[key]=fs[key];syncBuiltinESMExports();
  for(let round=0;round<32;round++){
   const run='run-'+round;const source={hooks:{Stop:[{hooks:[{type:'command',command:'${CLAUDE_PROJECT_DIR}/run',timeout:round}]}],SessionEnd:[{hooks:[{type:'http',url:'https://example.test',headers:{one:'two'}}]}]}};
   const fixture={'/repo/.claude/settings.json':JSON.stringify(source),'/repo/.git/info/exclude':'user\n','/repo/.codex/hooks.json':JSON.stringify({other:{untouched:true},hooks:{Stop:[{matcher:'',hooks:[]}],SessionStart:[]}})};
   const outputs=[];
   for(const api of [sdk,own]){vol.reset();vol.fromJSON(fixture,'/');const first=api.bridgeHooks('claude','codex','/repo','/home',run,{scope:'project'}),second=api.bridgeHooks('claude','codex','/repo','/home',run,{scope:'project'});const live=vol.readFileSync('/repo/.codex/hooks.json','utf8');api.cleanupBridgedHooks(first);const afterFirst=vol.readFileSync('/repo/.codex/hooks.json','utf8');api.cleanupBridgedHooks(second);api.cleanupBridgedHooks(second);outputs.push({first,second,live,afterFirst,cleaned:vol.toJSON()});}
   assert.deepEqual(outputs[1],outputs[0]);
  }
 }finally{restoreOwn();restoreSdk();Object.assign(builtin.default,original);syncBuiltinESMExports();vol.reset();}
});

test('filesystem missing codes are classified only on same-realm Error instances',async()=>{
 const builtin=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module'),{runInNewContext}=await import('node:vm');const original=builtin.default.lstatSync;
 const fn=()=>{};fn.code='ENOENT';const otherRealm=runInNewContext("Object.assign(new Error('foreign realm'),{code:'ENOENT'})");
 try{for(const fault of [{code:'ENOENT'},fn,otherRealm]){builtin.default.lstatSync=()=>{throw fault;};syncBuiltinESMExports();for(const api of [sdk,own]){let caught;try{api.readClaudeHooks('/repo','/home',{scope:'project'});}catch(error){caught=error;}assert.equal(caught,fault);}}}finally{builtin.default.lstatSync=original;syncBuiltinESMExports();}
});

test('failed native transformation preparation releases its live ownership',async()=>{
 const {fs,vol}=await import('memfs'),builtin=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module'),{setGitDirRunnerForTest}=await import('../dist/skill/testing.js');
 const keys=['lstatSync','readFileSync','writeFileSync','mkdirSync','renameSync','unlinkSync','rmdirSync','rmSync'];const original=Object.fromEntries(keys.map(key=>[key,builtin.default[key]]));const restore=setGitDirRunnerForTest(()=>'/setup/.git');
 try{
  for(const key of keys)builtin.default[key]=fs[key];syncBuiltinESMExports();
  for(const mode of ['invalid-command','missing-parent-stat']){
   vol.reset();const path='/setup/.claude/settings.json';vol.fromJSON({[path]:JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:mode==='invalid-command'?42:'run'}]}]}})},'/');
   const fault=new Error('parent preparation denied');let parentCalls=0;
   builtin.default.lstatSync=target=>{if(mode==='missing-parent-stat'&&String(target)==='/setup/.codex'&&++parentCalls===2)throw fault;return fs.lstatSync(target);};syncBuiltinESMExports();
   assert.throws(()=>own.bridgeHooks('claude','codex','/setup','/home',mode,{scope:'project'}));
   builtin.default.lstatSync=fs.lstatSync;syncBuiltinESMExports();vol.writeFileSync(path,JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'run'}]}]}}));
   const result=own.bridgeHooks('claude','codex','/setup','/home',mode,{scope:'project'});assert.deepEqual(result.generatedEntryIds,[`generated-${mode}-0`]);own.cleanupBridgedHooks(result);
  }
 }finally{restore();Object.assign(builtin.default,original);syncBuiltinESMExports();vol.reset();}
});

test('native lifecycle refuses callback reentry without mutating nested ownership',async()=>{
 const {fs,vol}=await import('memfs'),builtin=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module'),{setGitDirRunnerForTest}=await import('../dist/skill/testing.js');
 const keys=['lstatSync','readFileSync','writeFileSync','mkdirSync','renameSync','unlinkSync','rmdirSync','rmSync'];const original=Object.fromEntries(keys.map(key=>[key,builtin.default[key]]));const restore=setGitDirRunnerForTest(()=>'/reentry/.git');
 try{for(const key of keys)builtin.default[key]=fs[key];vol.fromJSON({'/reentry/.claude/settings.json':JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'run'}]}]}})},'/');let nested;
  builtin.default.mkdirSync=(target,opts)=>{if(String(target)==='/reentry/.codex'&&!nested){try{own.bridgeHooks('claude','codex','/reentry','/home','nested',{scope:'project'});}catch(error){nested=error;}}return fs.mkdirSync(target,opts);};syncBuiltinESMExports();
  const result=own.bridgeHooks('claude','codex','/reentry','/home','outer',{scope:'project'});assert.match(nested?.message??'',/already running/);own.cleanupBridgedHooks(result);
  const next=own.bridgeHooks('claude','codex','/reentry','/home','nested',{scope:'project'});assert.deepEqual(next.generatedEntryIds,['generated-nested-0']);own.cleanupBridgedHooks(next);
 }finally{restore();Object.assign(builtin.default,original);syncBuiltinESMExports();vol.reset();}
});
