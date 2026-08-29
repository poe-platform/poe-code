import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.dirname(new URL(import.meta.url).pathname);
const capture=fs.openSync(path.join(root,'publication.capture.data'),'wx',0o600);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
try{
 fs.writeSync(capture,JSON.stringify({event:'begin',at:new Date().toISOString(),role:'publication DATA only'})+'\n');
 const first=JSON.parse(fs.readFileSync(path.join(root,'acquisition.capture.data'),'utf8').split('\n')[0]);
 const conservativeStart=Date.parse(first.at)-60000;
 assert.ok(Date.now()-conservativeStart<1500000,'preparation deadline');
 const packet=JSON.parse(fs.readFileSync(path.join(root,'PACKET-SEAL.json'),'utf8'));
 for(const row of packet.files){const location=path.join(root,row.path);const stat=fs.lstatSync(location);assert.ok(stat.isFile());assert.equal(stat.size,row.bytes);assert.equal(stat.mode&511,row.mode);assert.equal(sha(fs.readFileSync(location)),row.sha256);}
 const files=[];let bytes=0;
 const scan=directory=>{for(const name of fs.readdirSync(directory).sort()){if(name.startsWith('publication')||name==='PUBLICATION.json')continue;const location=path.join(directory,name);const stat=fs.lstatSync(location);assert.ok(!stat.isSymbolicLink());if(stat.isDirectory())scan(location);else{assert.ok(stat.isFile()&&stat.size<=4194304);assert.ok(files.length<256);bytes+=stat.size;assert.ok(bytes<67108864);files.push({path:path.relative(root,location),bytes:stat.size,mode:stat.mode&511,sha256:sha(fs.readFileSync(location))});}}};
 scan(root);
 const result={createdAt:new Date().toISOString(),status:'PREPARATION_SEALED_AWAIT_DIFFERENT_REVIEW',packetSha256:sha(fs.readFileSync(path.join(root,'PACKET-SEAL.json'))),artifactFiles:files,artifactBytes:bytes,conservativeElapsedMs:Date.now()-conservativeStart,clockQualification:'acquisition capture minus60s conservatively covers immediately preceding setup/instruction read; not an OS-wide clock observer',knownProcessAccounting:{throughThisPublication:28,reservedFinalStageDiffCommitAndMetadata:5,finalKnownCeiling:33,authorizedCeiling:48,peakKnown:2,notOSWideCensus:true},nativeCases:{planned:12,executed:0,status:'UNRUN'},preexecControls:{proposed:12,executed:0},fixtureInventory:[],draftModules:9,materializedRuntime:false,actualGo:false,approvalRequested:false,oldGrantReused:false,heldTracksResumed:false,remainingOwnedChildren:0,retention:'small regular source/DATA artifacts only; no active temp run or child'};
 fs.writeFileSync(path.join(root,'PUBLICATION.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 fs.writeSync(capture,JSON.stringify({event:'complete',packetSha256:result.packetSha256,publicationSha256:sha(fs.readFileSync(path.join(root,'PUBLICATION.json'))),artifactBytes:bytes})+'\n');
 console.log(JSON.stringify({packetSha256:result.packetSha256,publicationSha256:sha(fs.readFileSync(path.join(root,'PUBLICATION.json'))),artifactFiles:files.length,artifactBytes:bytes,elapsedMs:result.conservativeElapsedMs,knownProcessCeiling:33}));
}catch(error){fs.writeSync(capture,JSON.stringify({event:'failure',message:String(error?.stack??error)})+'\n');process.exitCode=1;}
finally{fs.fsyncSync(capture);fs.closeSync(capture);}
