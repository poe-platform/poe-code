import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const started=Date.now(),packet=path.dirname(fileURLToPath(import.meta.url));
const work='/private/tmp/safe-bash-surface-direct-activation-v1-actual-01';
const stdout=fs.openSync(path.join(work,'capture/OWNER.stdout'),'wx+',384);
let stderr;try{stderr=fs.openSync(path.join(work,'capture/OWNER.stderr'),'wx+',384);}catch(reason){fs.closeSync(stdout);throw reason;}
let count=0,finalDeadline=started+1800000,hasPrimary=false,primary;
const secondary=[];
const error=reason=>({kind:reason===null?'null':typeof reason,...(reason instanceof Error?{name:reason.name,message:reason.message.slice(0,1024)}:['string','number','boolean'].includes(typeof reason)?{value:reason}: {})});
function fail(reason){if(!hasPrimary){hasPrimary=true;primary=reason;}else secondary.push(error(reason));}
function log(value,isError=false){if(Date.now()>=finalDeadline)throw Error('OWNER_FINAL_DEADLINE');const bytes=Buffer.from(JSON.stringify(value)+'\n');if(count+bytes.length>65536)throw Error('OWNER_CAPTURE_LIMIT');fs.writeFileSync(isError?stderr:stdout,bytes);count+=bytes.length;}
function read(name,expected){const filename=path.join(packet,name),stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2097152)throw Error('BOOTSTRAP_TYPE_SIZE');const descriptor=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=fs.fstatSync(descriptor);if(opened.ino!==stat.ino||opened.dev!==stat.dev)throw Error('BOOTSTRAP_IDENTITY');const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const count=fs.readSync(descriptor,bytes,offset,Math.min(65536,bytes.length-offset),offset);if(!count)throw Error('BOOTSTRAP_SHORT');offset+=count;}if(fs.readSync(descriptor,Buffer.alloc(1),0,1,offset)||createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('BOOTSTRAP_HASH');return bytes;}finally{fs.closeSync(descriptor);}}
try{
  log({event:'CAPTURE_STARTED',started,profile:'functional-direct-owned-child',toolShellStartup:'TRUSTED_HOST_OUTSIDE_CHILD_ENV_AND_CAPTURE_QUALIFICATION'});
  if(process.argv.length!==6||process.argv[2]!=='--seal-sha256'||process.argv[4]!=='--grant-sha256'||process.execArgv.length||process.env.NODE_OPTIONS!==undefined||process.env.NODE_PATH!==undefined)throw Error('OWNER_ARGUMENTS');
  const sealRaw=read('EXECUTABLE-SEAL.json',process.argv[3]),seal=JSON.parse(sealRaw);
  const grantRaw=read('GO.json',process.argv[5]),grant=JSON.parse(grantRaw);
  if((fs.lstatSync(path.join(packet,'GO.json')).mode&511)!==384||grant.schema!=='direct-activation-root-grant-v1'||grant.decision!=='GO'||grant.sealSha256!==process.argv[3]||grant.candidate!==seal.candidate||grant.profile!==seal.profile||grant.work!==work||grant.closureSha256!==seal.files['CANDIDATE-CLOSURE.json'].sha256||!Number.isSafeInteger(grant.notBeforeEpochMs)||!Number.isSafeInteger(grant.notAfterEpochMs)||Date.now()<grant.notBeforeEpochMs||grant.notAfterEpochMs-Date.now()<1800000)throw Error('GRANT_ADMISSION');
  finalDeadline=Math.min(finalDeadline,grant.notAfterEpochMs);
  if(JSON.stringify(grant.limits)!==JSON.stringify(seal.limits))throw Error('GRANT_LIMITS');
  const review=JSON.parse(read('INDEPENDENT-ACCEPTANCE.json',grant.reviewSha256));
  if(review.decision!=='ACCEPT'||review.sealSha256!==process.argv[3]||review.profileCommit!=='464666830d16016ca7a7bf9ef466aa6dc764e2d3'||review.scope!=='B-mechanism-and-final-activation-binding')throw Error('REVIEW_ADMISSION');
  for(const [name,pin]of Object.entries(seal.files)){if(name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('SEALED_PATH');if(read(name,pin.sha256).length!==pin.bytes)throw Error('SEALED_SIZE');}
  if(process.execPath!==seal.node.path||process.version!==seal.node.version)throw Error('NODE_EXECUTION_IDENTITY');
  const preprovisionPath=path.join(work,'PREPROVISIONED.json'),preprovisionStat=fs.lstatSync(preprovisionPath);
  if(!preprovisionStat.isFile()||preprovisionStat.isSymbolicLink()||preprovisionStat.size!==seal.preprovision.bytes)throw Error('PREPROVISION_TYPE_SIZE');
  const preprovisionBytes=fs.readFileSync(preprovisionPath);if(createHash('sha256').update(preprovisionBytes).digest('hex')!==seal.preprovision.sha256)throw Error('PREPROVISION_HASH');
  for(const name of ['home','tmp','empty-path']){const filename=path.join(work,name),stat=fs.lstatSync(filename);if(!stat.isDirectory()||stat.isSymbolicLink()||fs.readdirSync(filename).length)throw Error('PREPROVISIONED_DIRECTORY');}
  const rootNames=fs.readdirSync(work).sort();if(JSON.stringify(rootNames)!==JSON.stringify(['PREPROVISIONED.json','capture','empty-path','home','tmp']))throw Error('WORK_NOT_FRESH');
  if(JSON.stringify(fs.readdirSync(path.join(work,'capture')).sort())!==JSON.stringify(['OWNER.stderr','OWNER.stdout']))throw Error('CAPTURE_NOT_FRESH');
  const module=await import(pathToFileURL(path.join(packet,'supervisor.mjs')));
  const result=await module.run({packet,seal,grant,work,started,ownerLog:log});
  if(result.primaryPresent)fail(result.primary);
  log({event:'TERMINAL',completed:result.completed,unrun:result.unrun,primaryPresent:result.primaryPresent,terminalPublicationFailed:result.terminalPublicationFailed??false,knownChildStarts:result.ledger.starts});
}catch(reason){fail(reason);try{log({event:'STOP',primary:error(primary),secondary},true);}catch(error){fail(error);}}
finally{
  for(const descriptor of [stdout,stderr]){try{fs.fsyncSync(descriptor);const size=fs.fstatSync(descriptor).size;if(size>65536)throw Error('OWNER_CAPTURE_SIZE');const buffer=Buffer.alloc(size);let offset=0;while(offset<size){const count=fs.readSync(descriptor,buffer,offset,size-offset,offset);if(!count)throw Error('OWNER_CAPTURE_SHORT');offset+=count;}createHash('sha256').update(buffer).digest('hex');}catch(reason){fail(reason);}finally{try{fs.closeSync(descriptor);}catch(reason){fail(reason);}}}
  if(Date.now()>=finalDeadline)fail(Error('OWNER_FINAL_DEADLINE'));
  if(hasPrimary)process.exitCode=1;
}
