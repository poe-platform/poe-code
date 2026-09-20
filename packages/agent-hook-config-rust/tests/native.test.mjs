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
