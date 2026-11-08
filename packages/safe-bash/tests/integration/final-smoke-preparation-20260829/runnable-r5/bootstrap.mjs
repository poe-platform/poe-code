import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const activationStarted=Date.now();
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function admit(filename,expected,max){const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max);assert.equal(stat.size,expected.bytes);const bytes=fs.readFileSync(filename);assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256);return bytes;}
let primaryPresent=false,primary;
try{
  const [packetPath,digest,size,grantPath,grantDigest,grantSize]=process.argv.slice(2);assert.match(size,/^[1-9][0-9]*$/);assert.match(grantSize,/^[1-9][0-9]*$/);
  const packet=JSON.parse(admit(packetPath,{bytes:Number(size),sha256:digest},4194304));
  for(const row of packet.files)admit(row.path,row,4194304);
  const grant=JSON.parse(admit(grantPath,{bytes:Number(grantSize),sha256:grantDigest},16384));
  const {validateGrant,activationTimes}=await import('./policy.mjs');validateGrant(grant,digest);const times=activationTimes(activationStarted);
  const {run}=await import('./runtime.mjs');await run(packet,grant,times);
}catch(reason){primaryPresent=true;primary=reason;process.exitCode=78;}
if(primaryPresent)process.stderr.write(JSON.stringify({phase:'captured-activation',primaryPresent:true,primary:{type:primary===null?'null':typeof primary,message:primary instanceof Error?primary.message.slice(0,2048):['string','number','boolean'].includes(typeof primary)?primary:undefined},ownerExit:'PENDING_EXTERNAL_OBSERVATION'})+'\n');
