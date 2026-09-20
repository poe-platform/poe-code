import {test} from 'node:test';import assert from 'node:assert/strict';
import * as native from '../dist/index.js';import * as sdk from '../../agent-skill-config/dist/index.js';
test('own skill catalog aliases and independent configuration objects match SDK',()=>{
 assert.deepEqual(native.supportedAgents,sdk.supportedAgents);assert.ok(Object.isFrozen(native.supportedAgents));
 for(const input of ['claude',' CLAUDE ','Codex','goose','poe-agent','missing','constructor','\ud800'])assert.deepEqual(native.resolveAgentSupport(input),sdk.resolveAgentSupport(input));
 for(const input of native.supportedAgents){assert.deepEqual(native.getAgentConfig(input),sdk.getAgentConfig(input));const first=native.getAgentConfig(input);first.localSkillDir='redirected';assert.deepEqual(native.getAgentConfig(input),sdk.getAgentConfig(input));}
 for(const path of ['~','~/','~./foo','~.foo','~\\foo','ordinary'])for(const scope of ['local','global']){const config={globalSkillDir:path,localSkillDir:path};assert.equal(native.resolveSkillDir(config,scope,'/repo','/home'),sdk.resolveSkillDir(config,scope,'/repo','/home'));}
});

test('filesystem missing codes are classified only on same-realm Error instances',async()=>{
 const builtin=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module'),{runInNewContext}=await import('node:vm');const original=builtin.default.statSync;
 const fn=()=>{};fn.code='ENOENT';const otherRealm=runInNewContext("Object.assign(new Error('foreign realm'),{code:'ENOENT'})");
 try{for(const fault of [{code:'ENOENT'},fn,otherRealm]){builtin.default.statSync=()=>{throw fault;};syncBuiltinESMExports();for(const api of [sdk,native]){let caught;try{api.resolveSkillReference('foo','/repo','/home');}catch(error){caught=error;}assert.equal(caught,fault);}}}finally{builtin.default.statSync=original;syncBuiltinESMExports();}
});
test('native skill apply preserves SDK byte output, observers, user files and dry runs',async()=>{
 assert.equal(typeof native.configure,'function');assert.equal(typeof native.installSkill,'function');
 const {Volume}=await import('memfs');
 for(const agent of native.supportedAgents)for(const scope of ['local','global'])for(const dryRun of [false,true]){
  const results=[];
  for(const api of [sdk,native]){
   const vol=new Volume();vol.fromJSON({'/repo/.keep':'repo','/home/.keep':'home'},'/');const fs=vol.promises,events=[];
   const observers={onStart:details=>events.push(['start',details]),onComplete:(details,outcome)=>events.push(['complete',details,outcome]),onError:(details,error)=>events.push(['error',details,error.message])};
   const options={fs,cwd:'/repo',homeDir:'/home',scope,dryRun,observers};
   await api.configure(agent,options);await api.configure(agent,options);
   const result=await api.installSkill(agent,{name:'😀',content:'---\nname: 😀\n---\nbody\n'},options);
   await api.unconfigure(agent,{...options,force:true});results.push({files:vol.toJSON(),events,result});
  }
  assert.deepEqual(results[1],results[0]);
 }
 for(const api of [sdk,native]){
  const vol=new Volume();vol.fromJSON({'/repo/.claude/skills/poe-generate.md':'user','/home/.keep':'home'},'/');
  const options={fs:vol.promises,cwd:'/repo',homeDir:'/home',scope:'local'};
  await assert.rejects(api.configure('claude',options),error=>error.name==='UserError'&&error.message.includes('Move or delete'));
  await api.unconfigure('claude',{...options,force:false});assert.equal(vol.readFileSync('/repo/.claude/skills/poe-generate.md','utf8'),'user');
  await assert.rejects(api.installSkill('claude',{name:'../escape',content:'body'},options),/Invalid skill name/);
  await assert.rejects(api.configure('unknown',options),api.UnsupportedAgentError);
  const fault=new Error('denied');await assert.rejects(api.configure('claude',{...options,fs:{...options.fs,stat:async()=>{throw fault;}}}),error=>error===fault);
 }
});
test('native template loader retains bundled byte content and missing-template admission',async()=>{
 const own=await import('../dist/templates.js'),reference=await import('../../agent-skill-config/dist/templates.js');
 for(const id of ['poe-generate.md','terminal-pilot.md'])assert.equal(await own.loadTemplate(id),await reference.loadTemplate(id));
 for(const api of [own,reference])await assert.rejects(api.loadTemplate('missing.md'),error=>error.message==='Template not found: missing.md');
});
