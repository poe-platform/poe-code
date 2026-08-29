import {functionalProfile} from './functional-profile.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { authenticatePacket as authenticateAdmission } from '../../authorization.mjs';
import { readRegular } from '../../../executor-v3/regular-read.mjs';
import { grantData } from './contracts.mjs';
import { dataObject, denseArray, hashString } from '../../../executor-v7-r2/schema.mjs';
export const home = path.dirname(fileURLToPath(import.meta.url));
export const baseRoot = path.resolve(home, '../..');
export const repository = path.resolve(baseRoot, '../../../..');
export const runId = 'semantic-functional-20260829-v2-01';
export const originalRecipe = 'bd4690d595751b99b3a2bf020f0063f86c03b23ae2600ecaa637be7dc6096b1c';
export const originalInterface = 'f6c3965ad7b31747dad30b3357de8813a28b3c18963a39ad04582358e3f55c18';
export const planSha256 = '9c8a87408a8769f1151cb937a3e5409140e17186da13a592af34e18ba770e736';
export const acceptedAdmission = Object.freeze({ path: 'tests/comparison/breadth-continuation-20260828/executor-v7-r3/runs/admission-20260829-v7r3-02/RESULT.json', sha256: '22d9624cb1cfd3154b6070a3cde96d0958a202f2042ef80df37b012430bd7de0' });
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function requireThat(value, code) { if (!value) throw Object.assign(new Error(code), { code }); }
export function regular(filename, cap = 262144) {
  const info = fs.lstatSync(filename);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.size <= cap && (info.mode & 4095) === 420, 'PROFILE_REGULAR');
  return readRegular(filename, info.size);
}
export function verifySuccessor() {
  const bytes = regular(path.join(home, 'SEAL.json'));
  const seal = dataObject(JSON.parse(bytes), ['schema','originalRecipe','originalInterface','files','inherited','tools','controls','permission']);
  requireThat(seal && seal.schema === 'SEMANTIC_FUNCTIONAL_SUCCESSOR_V2' && seal.originalRecipe === originalRecipe && seal.originalInterface === originalInterface && seal.permission === 'PREEXECUTION_ONLY', 'PROFILE_SCHEMA');
  const entries = denseArray(seal.files, 64), inherited = denseArray(seal.inherited, 64), tools = denseArray(seal.tools, 8);
  requireThat(entries && entries.length > 0 && inherited && tools && tools.length === 3 && seal.controls === 14, 'PROFILE_ARRAY');
  const names = new Set(['SEAL.json','evidence','runs']);
  for (const row of entries) {
    const item = dataObject(row, ['path','bytes','mode','sha256']);
    requireThat(item && typeof item.path === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(item.path) && item.path.toLowerCase() !== 'agents.md' && !names.has(item.path) && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= 262144 && item.mode === 420 && hashString(item.sha256), 'PROFILE_MEMBER');
    names.add(item.path);
    const content = regular(path.join(home, item.path));
    requireThat(content.length === item.bytes && digest(content) === item.sha256, 'PROFILE_HASH');
  }
  for (const item of fs.readdirSync(home)) {
    requireThat(names.has(item), 'PROFILE_NEW_ENTRY');
    if (['evidence','runs'].includes(item)) { const info = fs.lstatSync(path.join(home,item)); requireThat(info.isDirectory() && !info.isSymbolicLink(), 'PROFILE_OUTPUT_DIRECTORY'); }
  }
  for (const row of inherited) {
    const item = dataObject(row, ['path','bytes','mode','sha256']);
    requireThat(item && typeof item.path === 'string' && item.path.startsWith(baseRoot + '/') || item && typeof item.path === 'string' && item.path.startsWith(path.resolve(baseRoot,'..') + '/'), 'PROFILE_INHERITED_PATH');
    requireThat(!item.path.split('/').some(name => name.toLowerCase() === 'agents.md') && item.mode === 420 && hashString(item.sha256), 'PROFILE_INHERITED');
    const content = regular(item.path);
    requireThat(content.length === item.bytes && digest(content) === item.sha256, 'PROFILE_INHERITED_HASH');
  }
  for (const value of tools) {
    const item=dataObject(value,['path','bytes','mode','sha256']);
    requireThat(item && typeof item.path==='string' && path.isAbsolute(item.path) && Number.isSafeInteger(item.bytes) && item.bytes>0 && item.bytes<=240000000 && item.mode===493 && hashString(item.sha256),'PROFILE_TOOL');
    const info=fs.lstatSync(item.path);requireThat(info.isFile() && !info.isSymbolicLink() && info.size===item.bytes && (info.mode&4095)===item.mode,'PROFILE_TOOL_METADATA');
    const descriptor=fs.openSync(item.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const hash=createHash('sha256');const buffer=Buffer.alloc(65536);let offset=0;
    try{const opened=fs.fstatSync(descriptor);requireThat(opened.dev===info.dev && opened.ino===info.ino && opened.size===info.size && (opened.mode&4095)===item.mode,'PROFILE_TOOL_OPENED');while(offset<info.size){const count=fs.readSync(descriptor,buffer,0,Math.min(buffer.length,info.size-offset),offset);requireThat(count>0,'PROFILE_TOOL_SHORT');hash.update(buffer.subarray(0,count));offset+=count;}requireThat(fs.readSync(descriptor,buffer,0,1,offset)===0,'PROFILE_TOOL_GREW');}finally{fs.closeSync(descriptor);}
    requireThat(hash.digest('hex')===item.sha256,'PROFILE_TOOL_HASH');
  }
  requireThat(digest(regular(path.join(baseRoot,'SEAL.json'))) === originalRecipe && digest(regular(path.join(baseRoot,'INTERFACE.json'))) === originalInterface, 'ORIGINAL_PROFILE_DRIFT');
  return digest(bytes);
}
export function authenticatePacket(root) {
  requireThat(root === baseRoot, 'SEMANTIC_ROOT');
  requireThat(authenticateAdmission(root) === originalRecipe, 'ADMISSION_RECIPE_DRIFT');
  return verifySuccessor();
}
export function bindSemanticGrant(value, recipe, reviewSha256) {
  const grant=grantData(value); requireThat(grant,'SEMANTIC_GRANT_SCHEMA');
  requireThat(grant.functionalProfile===functionalProfile && grant.phase === 'cohort' && grant.runId === runId && grant.outputRoot === path.join(baseRoot,'runs',runId) && grant.recipeSha256 === recipe && grant.reviewSha256 === reviewSha256 && grant.planSha256 === planSha256, 'SEMANTIC_GRANT_BINDING');
  requireThat(grant.acceptedAdmission.path === acceptedAdmission.path && grant.acceptedAdmission.sha256 === acceptedAdmission.sha256, 'SEMANTIC_ADMISSION_BINDING');
  return grant;
}

