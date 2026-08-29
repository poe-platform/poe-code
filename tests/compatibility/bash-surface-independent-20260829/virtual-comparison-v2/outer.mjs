import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const started=Date.now(),packet=path.dirname(fileURLToPath(import.meta.url)),work='/private/tmp/safe-bash-virtual-comparison-v2-actual-01';
const out=fs.openSync(path.join(work,'capture/OWNER.stdout'),'wx',0o600);let err;try{err=fs.openSync(path.join(work,'capture/OWNER.stderr'),'wx',0o600);}catch(reason){fs.closeSync(out);throw reason;}let count=0;
function ownerLog(value,isError=false){const bytes=Buffer.from(JSON.stringify(value)+'\n');if(count+bytes.length>65536)throw Error('OWNER_CAPTURE_LIMIT');fs.writeFileSync(isError?err:out,bytes);count+=bytes.length;}
function readPinned(name,expected){const file=path.join(packet,name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4194304)throw Error('BOOTSTRAP_TYPE_SIZE');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const bytes=Buffer.alloc(stat.size);try{let offset=0;while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,Math.min(65536,bytes.length-offset),offset);if(!count)throw Error('BOOTSTRAP_SHORT');offset+=count;}if(fs.readSync(fd,Buffer.alloc(1),0,1,offset))throw Error('BOOTSTRAP_LONG');}finally{fs.closeSync(fd);}if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('BOOTSTRAP_HASH');return bytes;}
let primary=false;
try{
 ownerLog({event:'CAPTURE_STARTED',started});if(process.argv.length!==6||process.argv[2]!=='--grant-sha256'||process.argv[4]!=='--seal-sha256')throw Error('EXACT_ARGUMENTS');
 const grantRaw=readPinned('GO.json',process.argv[3]),sealRaw=readPinned('EXECUTABLE-SEAL.json',process.argv[5]);const grant=JSON.parse(grantRaw),seal=JSON.parse(sealRaw);
 if((fs.lstatSync(path.join(packet,'GO.json')).mode&0o777)!==0o600||grant.decision!=='GO'||grant.schema!=='virtual-comparison-v2-root-grant'||grant.sealSha256!==process.argv[5]||grant.candidate!==seal.candidate||grant.packageSha256!==seal.archive.sha256||!Number.isSafeInteger(grant.notAfterEpochMs)||grant.notAfterEpochMs-Date.now()<1800000)throw Error('GRANT_ADMISSION');
 const review=JSON.parse(readPinned('INDEPENDENT-ACCEPTANCE.json',grant.reviewSha256));if(review.decision!=='ACCEPT'||review.sealSha256!==process.argv[5])throw Error('REVIEW_ADMISSION');
 for(const [name,pin]of Object.entries(seal.files)){const bytes=readPinned(name,pin.sha256);if(bytes.length!==pin.bytes)throw Error('SEALED_SIZE');}
 const module=await import(pathToFileURL(path.join(packet,'supervisor.mjs')));const result=await module.run({packet,work,seal,grant,started,ownerLog});ownerLog({event:'TERMINAL',completed:result.completed,unrun:result.unrun,primaryPresent:result.primaryPresent});if(result.primaryPresent)process.exitCode=1;
}catch(reason){primary=true;try{ownerLog({event:'STOP',name:reason instanceof Error?reason.name:typeof reason,message:reason instanceof Error?reason.message:undefined},true);}catch{}process.exitCode=1;}
finally{for(const fd of [out,err]){try{fs.fsyncSync(fd);fs.closeSync(fd);}catch{primary=true;process.exitCode=1;}}}
