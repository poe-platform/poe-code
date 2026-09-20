import {test} from 'node:test';import assert from 'node:assert/strict';
import * as native from '../dist/index.js';import * as sdk from '../../agent-skill-config/dist/index.js';
test('own skill catalog aliases and independent configuration objects match SDK',()=>{
 assert.deepEqual(native.supportedAgents,sdk.supportedAgents);assert.ok(Object.isFrozen(native.supportedAgents));
 for(const input of ['claude',' CLAUDE ','Codex','goose','poe-agent','missing','constructor','\ud800'])assert.deepEqual(native.resolveAgentSupport(input),sdk.resolveAgentSupport(input));
 for(const input of native.supportedAgents){assert.deepEqual(native.getAgentConfig(input),sdk.getAgentConfig(input));const first=native.getAgentConfig(input);first.localSkillDir='redirected';assert.deepEqual(native.getAgentConfig(input),sdk.getAgentConfig(input));}
 for(const path of ['~','~/','~./foo','~.foo','~\\foo','ordinary'])for(const scope of ['local','global']){const config={globalSkillDir:path,localSkillDir:path};assert.equal(native.resolveSkillDir(config,scope,'/repo','/home'),sdk.resolveSkillDir(config,scope,'/repo','/home'));}
});
