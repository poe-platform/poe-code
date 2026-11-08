import * as native from '../dist/index.js';import * as sdk from '@poe-code/agent-skill-config/node';
const original:typeof sdk=native;const compatibleNative:typeof native=sdk;void[original,compatibleNative];
import path from 'node:path';
const portableSkillPath:string=native.resolveSkillDir({globalSkillDir:'~/skills',localSkillDir:'skills'},'global','/repo','/home',path.posix);
void portableSkillPath;
const serializedBridge:native.BridgeManifest={bridgeId:'bridge',spawnAgentId:'claude',cwd:'/repo',runId:'run',entries:[],warnings:[]};
const bridgeId:string|undefined=serializedBridge.bridgeId;
void bridgeId;
