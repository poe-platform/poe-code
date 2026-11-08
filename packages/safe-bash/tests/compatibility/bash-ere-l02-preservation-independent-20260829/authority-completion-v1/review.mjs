import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo='/Users/kjopek/Workspace/safe-bash';
const own=path.dirname(fileURLToPath(import.meta.url));
const parent=path.join(repo,'tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/followup-preparation-r4');
const receiptPath=path.join(repo,'tests/compatibility/bash-l02-followup-independent-20260829/r4/REVIEW-ACCEPTANCE.json');
const profileHash='dbb576cdb97945543ef15cb02548f3cbe12875cbeab4bb01af2d60addf5dbffa';
const grantHash='b0cf01197a9ab3fdf5439540759541b04c923f10004b16e1620f17f9534ecc78';
const receiptHash='39244351bc27769439f7f881cdeb6b68b92f694eb9f21c316a9f0eff44acea69';
const bound=[];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function write(name,value){const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');assert(bytes.length<=2097152);fs.writeFileSync(path.join(own,name),bytes,{flag:'wx'});}
function read(filename,size,hash){const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1048576);assert.equal(fs.realpathSync(filename),filename);if(size!==undefined)assert.equal(stat.size,size);const bytes=fs.readFileSync(filename);assert.equal(bytes.length,stat.size);if(hash)assert.equal(sha(bytes),hash);bound.push({path:filename,bytes:bytes.length,sha256:sha(bytes),mode:stat.mode&511});return bytes;}
function blob(commit,filename,name){const result=spawnSync('/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false','cat-file','blob',commit+':'+path.relative(repo,filename)],{cwd:repo,maxBuffer:1048576,timeout:10000});write(name+'.stdout',result.stdout);write(name+'.stderr',result.stderr);assert.equal(result.status,0);assert.equal(result.signal,null);assert(!result.error);return result.stdout;}
try{
 write('PRESEAL.json',{scope:'Narrow SOURCE/DATA completion only',expected:{receipt:{path:receiptPath,bytes:1250,sha256:receiptHash,commit:'2e6d59787df9d1949d9e342fbd2769cb76240651'},grant:{bytes:523,sha256:grantHash},profileHash},authorBinding:'5a2e4a11c647cffcfbfd8d77122f467e9e28f12d',membership:'receipt+pending grant+static activation formula+consumed grant if present+profile+command',roles:{helper:1,metadataGit:2,syntaxOnly:1,ceilingKnownOS:12,peak:3},runtime:0});
 const receiptBytes=read(receiptPath,1250,receiptHash);assert.deepEqual(blob('2e6d59787df9d1949d9e342fbd2769cb76240651',receiptPath,'receipt-git'),receiptBytes);
 const activationPath=path.join(parent,'activation.mjs');const activationSource=read(activationPath);
 assert.deepEqual(blob('5a2e4a11c647cffcfbfd8d77122f467e9e28f12d',activationPath,'activation-git'),activationSource);
 const source=activationSource.toString();assert(source.includes("const own=fileURLToPath(new URL('.',import.meta.url))"));assert(source.includes("writeFileSync(join(own,'ROOT-GRANT.json'),grantBytes,{flag:'wx'})"));assert(source.includes("read(join(own,'EXECUTION-PRESEAL.json'),1048576)"));
 const pending=read(path.join(parent,'binding-v2/PENDING-GRANT.json'),523,grantHash);
 const profileBytes=read(path.join(parent,'EXECUTION-PRESEAL.json'),undefined,profileHash);
 const command=read(path.join(parent,'binding-v2/ACTIVATION-COMMAND.sh.data'),1739,'7c13045d3b06de10486ce29a3c7160cae665c4fed1f7b8eb62bb155f2f0a0d95');
 assert(command.toString().includes(pending.toString('base64')));assert(command.toString().includes(grantHash));assert(command.toString().includes(profileHash));
 const receipt=JSON.parse(receiptBytes),grant=JSON.parse(pending);assert.equal(receipt.status,'SCOPED_PREEXEC_ACCEPT');assert.equal(receipt.profileSha256,profileHash);assert.equal(grant.profileSha256,profileHash);assert.equal(grant.reviewCommit,'2e6d59787df9d1949d9e342fbd2769cb76240651');assert.equal(grant.reviewReceiptSha256,receiptHash);assert.equal(grant.authorized,true);assert(!Object.hasOwn(grant,'rootReceipt'));assert.equal(grant.runId,'ERE-L02-FOLLOWUP-r4');
 let consumed;const consumedPath=path.join(parent,'ROOT-GRANT.json');
 try{const actual=read(consumedPath,523,grantHash);assert.deepEqual(actual,pending);consumed={path:consumedPath,read:true,bytes:actual.length,sha256:sha(actual),qualification:'Fresh present-byte observation only, not proof of continuous immutability since runtime.'};}
 catch(reason){if(reason?.code!=='ENOENT')throw reason;consumed={path:consumedPath,read:false,unavailable:'ENOENT',qualification:'Pending identical bytes authenticate authority; no consumed-path postguard claim.'};}
 const activationBytes=read(path.join(parent,'preservation-v1/DATA/FUTURE-ACTUAL-01/ACTIVATION.json'));const activation=JSON.parse(activationBytes);assert.equal(activation.profileSha256,profileHash);assert.equal(activation.grantSha256,grantHash);assert.equal(activation.pid,84282);
 for(const row of [...bound])read(row.path,row.bytes,row.sha256);
 const result={verdict:'QUALIFIED_DATA_AUTHORITY_COMPLETION_ACCEPT',receiptCommit:'2e6d59787df9d1949d9e342fbd2769cb76240651',authorBinding:'5a2e4a11c647cffcfbfd8d77122f467e9e28f12d',bound,consumed,grant,activation,authority:'ROOT message explicitly authorized exact1739-byte command/523-byte grant before the one actual attempt; not inferred solely from authorized:true and no invented rootReceipt field.',inherited:'dc3333e2d finite62-file retention/4+3 controls; original binding HOLD preserved, no replay',retirement:'UNKNOWN unchanged; no new cleanup/retirement credit',actual:{helpers:1,gitMetadataChildren:2,product:0,workers:0,runtime:0},atUTC:new Date().toISOString()};
 write('RESULT.json',result);
 write('REPORT.md',`# L02 authority DATA completion\n\nQUALIFIED DATA ACCEPT, composed with dc3333e2d retention; old incomplete-authority result is not rescored. Exact1250B review receipt ${receiptHash} matches commit2e6d59787df9d1949d9e342fbd2769cb76240651. Exact523B pending grant ${grantHash}; profile ${profileHash}; exact1739B command7c13045d3b06de10486ce29a3c7160cae665c4fed1f7b8eb62bb155f2f0a0d95. Command contains identical base64 grant and exact profile/hash arguments.\n\nConsumed locator derived ONLY from committed activation.mjs formula join(own,'ROOT-GRANT.json'), with own the module directory. Actual consumed path read: ${consumed.read}. ${consumed.qualification}\n\nROOT authority is the explicit prior message for this command/grant, not a fabricated rootReceipt field or mere authorized:true. Issued/latest/expiry are historical and do not authorize another execution. PREEXEC profile/source scope stays finite; no runtime reacceptance or OS/tool-service attestation.12 observedPASS/1STOP_UNCONFIRMED/0UNRUN,9 prior exits/final0,stickyUNKNOWN and outer0/0B/noEOF qualifications remain.\n\nOne DATA helper/two metadata Git children natural exit0; no product/Workers/native/runtime/cleanup/signals. Main raw startup files opened before Node. Scope within12 known roles/peak3 including publication; not transitive OS census. No broad scan or compressed decoding.\n`);
 console.log(JSON.stringify({verdict:result.verdict,consumed,receiptSha256:sha(fs.readFileSync(path.join(own,'RESULT.json')))}));
}catch(reason){console.error(reason);write('FAILURE.json',{primaryPresent:true,detail:String(reason),stack:reason?.stack,bound});process.exitCode=1;}
