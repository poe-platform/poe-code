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
