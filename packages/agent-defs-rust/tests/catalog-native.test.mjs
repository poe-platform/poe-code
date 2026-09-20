import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import * as own from '../dist/index.js';import * as reference from '../../agent-defs/dist/index.js';
const native=createRequire(import.meta.url)('../dist/agent-defs-rust.node');
function snapshot(api){return api.allAgents.map(agent=>({...agent,otelCapture:agent.otelCapture===undefined?undefined:{...agent.otelCapture,args:typeof agent.otelCapture.args==='function'?'function':undefined}}));}
test('actual native catalog matches all original metadata, export identities and freeze boundaries',()=>{
 assert.equal(typeof native.catalogDefinitions,'function');assert.deepEqual(snapshot(own),snapshot(reference));
 for(const key of Object.keys(reference).filter(name=>name.endsWith('Agent'))){assert.equal(own[key],own.allAgents.find(agent=>agent.id===reference[key].id));}
 for(let i=0;i<own.allAgents.length;i++)for(const get of [agent=>agent,agent=>agent.aliases,agent=>agent.capabilities,agent=>agent.apiShapes,agent=>agent.otelCapture,agent=>agent.otelCapture?.env,agent=>agent.branding,agent=>agent.branding.colors,agent=>agent.configPaths])assert.equal(Object.isFrozen(get(own.allAgents[i])),Object.isFrozen(get(reference.allAgents[i])));
});
test('native capabilities and Unicode lookup keys preserve original outputs without mutable cached lists',()=>{
 const inputs=['claude','CLAUDE','\ufeffPI-AGENT\u00a0','GeMiNi','cursor-agent','unknown','constructor','toString','kimi','Pİ','Σ','\ud800',...reference.allAgents.map(agent=>agent.id)];
 for(const cap of ['spawn','configure','install','test','skill','mcp','missing']){
  for(const includeAliases of [false,true]){const actual=own.listAgentsWithCapability(cap,{includeAliases}),expected=reference.listAgentsWithCapability(cap,{includeAliases});assert.deepEqual(actual,expected);actual.push('injected');assert.deepEqual(own.listAgentsWithCapability(cap,{includeAliases}),expected);}
  for(const input of inputs){assert.equal(own.resolveAgentId(input),reference.resolveAgentId(input));assert.equal(own.agentSupportsCapability(input,cap),reference.agentSupportsCapability(input,cap));assert.equal(own.formatAgentCapabilityError({agent:input,capability:cap}),reference.formatAgentCapabilityError({agent:input,capability:cap}));}
 }
});
test('native specifiers preserve raw Unicode, casing, extra colons and TypeError admission',()=>{
 for(const input of ['claude:Provider/Model:variant',' CLAUDE :Mixed/Model ','codex:','\ufeffcustom\u00a0: model ','\ud800:\udfff','unknown:UPPER']){assert.deepEqual(own.parseAgentSpecifier(input),reference.parseAgentSpecifier(input));assert.equal(own.normalizeAgentId(input),reference.normalizeAgentId(input));}
 for(const input of ['',':model',' \ufeff :model'])for(const name of ['parseAgentSpecifier','normalizeAgentId'])assert.throws(()=>own[name](input),{name:'TypeError',message:'agent must not be empty'});
 for(const model of [undefined,'',' ',' Provider/Model:variant ','\ud800'])assert.equal(own.formatAgentSpecifier({agent:' CLAUDE ',model}),reference.formatAgentSpecifier({agent:' CLAUDE ',model}));
 let reads=0;const inherited=Object.create({get model(){reads++;throw Error('inherited');}});inherited.agent='codex';assert.equal(own.formatAgentSpecifier(inherited),'codex');assert.equal(reads,0);
 const invalid={agent:' ',get model(){reads++;throw Error('model read too early');}};assert.throws(()=>own.formatAgentSpecifier(invalid),{name:'TypeError',message:'agent must not be empty'});assert.equal(reads,0);
});
test('declarative telemetry arguments escape every UTF16 edge identically to original',()=>{
 for(const input of ['https://localhost:4318','https://host/"\\\n\0😀\ud800',''])for(const content of [false,true])assert.deepEqual(own.codexAgent.otelCapture.args(input,content),reference.codexAgent.otelCapture.args(input,content));
});
test('capability alias options preserve original getter evaluation per admitted agent',()=>{
 function capture(api,capability){let reads=0;const values=api.listAgentsWithCapability(capability,{get includeAliases(){return ++reads%2===1;}});return {reads,values};}
 for(const capability of ['skill','spawn','missing'])assert.deepEqual(capture(own,capability),capture(reference,capability));
});
test('Node specifiers use shared Rust policy without per-call native string copies',()=>{
 assert.deepEqual(native.catalogSpecifierPolicy(),{delimiter:':',emptyAgentError:'agent must not be empty'});
 const saved={};for(const key of ['catalogParseSpecifier','catalogFormatSpecifier','catalogNormalizeSpecifier']){saved[key]=native[key];native[key]=()=>{throw Error('unnecessary native string copy');};}
 try{
  const input=' CLAUDE :Provider/Model:variant ';
  assert.deepEqual(own.parseAgentSpecifier(input),reference.parseAgentSpecifier(input));assert.equal(own.normalizeAgentId(input),reference.normalizeAgentId(input));assert.equal(own.formatAgentSpecifier({agent:' CLAUDE ',model:' Provider/Model '}),reference.formatAgentSpecifier({agent:' CLAUDE ',model:' Provider/Model '}));
 }finally{Object.assign(native,saved);}
});
