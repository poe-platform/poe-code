import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {fileIdentity,directoryIdentity} from './external.mjs';
import {BOUNDS} from './policy.mjs';
import {sha,directory,candidate} from './common.mjs';
import {join} from 'node:path';
import {verifyInstructionFenceExternal} from './os-instruction-fence.mjs';
import {inspectLinkage,rejectToolSelection} from './tool-routing.mjs';

export const SYSTEM_REFERENCES=Object.freeze([
  ['/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node','/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation'],
  ['/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node','/System/Library/Frameworks/Security.framework/Versions/A/Security'],
  ['/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node','/usr/lib/libc++.1.dylib'],
  ['/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node','/usr/lib/libSystem.B.dylib'],
  ['/Applications/Xcode.app/Contents/Developer/usr/bin/git','/System/Library/Frameworks/CoreServices.framework/Versions/A/CoreServices'],
  ['/Applications/Xcode.app/Contents/Developer/usr/bin/git','/usr/lib/libz.1.dylib'],
  ['/Applications/Xcode.app/Contents/Developer/usr/bin/git','/usr/lib/libiconv.2.dylib'],
  ['/Applications/Xcode.app/Contents/Developer/usr/bin/git','/usr/lib/libSystem.B.dylib'],
  ['/Applications/Xcode.app/Contents/Developer/usr/bin/git','/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation'],
  ['/usr/bin/tar','/usr/lib/libarchive.2.dylib'],
  ['/usr/bin/tar','/usr/lib/libSystem.B.dylib'],
]);
export function rejectAmbientInjection(environment){
  rejectToolSelection(environment);
  for(const[key,value]of Object.entries(environment))if(value&&(key==='NODE_OPTIONS'||key==='NODE_PATH'||key.startsWith('DYLD_')||key.startsWith('LD_')||key.startsWith('GIT_')))throw Object.assign(new Error('ambient loader/Git injection refused: '+key),{exitCode:78});
}
export function validateSystemBoundary(report){
  assert.equal(report.host.platform,'darwin');assert.equal(report.host.arch,'arm64');
  assert.match(report.host.stdout,/ProductVersion:\s+26\.4\.1(?:\s|$)/u);assert.match(report.host.stdout,/BuildVersion:\s+25E253(?:\s|$)/u);
  const references=report.linkage.flatMap(tool=>tool.dependencies.map(entry=>[tool.origin,entry.path]));
  assert.deepEqual(references,SYSTEM_REFERENCES,'system exception is exactly eleven sampled tool/reference pairs');
  assert.ok(report.linkage.every(tool=>tool.dependencies.every(entry=>entry.identity===null&&entry.error==='ENOENT')));
  return{systemReferences:SYSTEM_REFERENCES,host:report.host,qualification:'Explicit trusted macOS26.4.1/build25E253 boundary for exactly these eleven sampled references only. No readable-file hash, full OS attestation, complete process-image enumeration or broader library exception.'};
}
export function externalReceipt(){
  const receipt=JSON.parse(readFileSync(join(directory,'EXTERNAL-RECEIPT.json')));
  assert.equal(receipt.candidate,candidate.candidate,'external identity receipt belongs to this exact unified candidate');
  const encoded=readFileSync(join(directory,'EXTERNAL.json.gz.base64'));assert.equal(sha(encoded),receipt.encodedSha256);
  const bytes=gunzipSync(Buffer.from(encoded.toString().trim(),'base64'));assert.equal(sha(bytes),receipt.sha256);
  const report=JSON.parse(bytes);validateSystemBoundary(report);return{receipt,report};
}
export async function verifyUnreadableSystemReferences(identity=fileIdentity){
  for(const[,path]of SYSTEM_REFERENCES){let missing=false;try{await identity(path);}catch(error){assert.equal(error.code,'ENOENT','OS exception requires the captured absent-file condition');missing=true;}assert.ok(missing,'new readable library requires an explicit file-hash binding: '+path);}
}
export async function verifyExternal(environment=process.env){
  rejectAmbientInjection(environment);const{receipt,report}=externalReceipt();
  for(const tool of report.tools)assert.deepEqual(await fileIdentity(tool.origin),tool,'readable tool identity changed: '+tool.origin);
  for(const tree of Object.values(report.directories))assert.deepEqual(await directoryIdentity(tree.origin),tree,'dependency closure changed: '+tree.origin);
  const host=spawnSync('/usr/bin/sw_vers',[],{encoding:'utf8',timeout:10000,maxBuffer:BOUNDS.setupStderrBytes});assert.equal(host.status,0);assert.equal(host.signal,null);assert.equal(host.stdout,report.host.stdout);
  await verifyUnreadableSystemReferences();
  const inspection=[];
  for(const tool of report.linkage){const result=inspectLinkage(tool.origin,environment);assert.equal(result.stdout,tool.stdout);inspection.push(result);}
  return{sha256:receipt.sha256,tools:report.tools.length,directories:Object.keys(report.directories),native:report.native.assets.length,systemBoundary:validateSystemBoundary(report),readableBindingsVerified:true,inspection,osInstructionFence:verifyInstructionFenceExternal()};
}
