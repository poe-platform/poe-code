import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const own=path.dirname(new URL(import.meta.url).pathname);
const capture=fs.openSync(path.join(own,'seal.capture.data'),'wx',0o600);
try{
  fs.writeSync(capture,JSON.stringify({event:'start',at:new Date().toISOString()})+'\n');
  const files=['PRESEAL.md','ROUTING.md','check.mjs','seal.mjs','SOURCE-DATA.json','capture.data','outer.stdout.data','outer.stderr.data','syntax.stdout.data','syntax.stderr.data'];
  const rows=files.map(name=>{
    const location=path.join(own,name);const stat=fs.lstatSync(location);
    if(!stat.isFile()||stat.size>2097152)throw Error('file admission');
    return{path:name,bytes:stat.size,mode:stat.mode&0o777,sha256:crypto.createHash('sha256').update(fs.readFileSync(location)).digest('hex')};
  });
  const receipt={at:new Date().toISOString(),role:'SOURCE/DATA authority clarification',files:rows,bytes:rows.reduce((total,row)=>total+row.bytes,0),productLoads:0,nativeExecutions:0,knownProcessesThroughSeal:10,reservedGitPublicationAndMetadata:5,knownFinalCeiling:15,authorizedCeiling:16,peakKnown:2,originalOutcome:'17PASS7FAIL per layout preserved',authority:'GNU documented model verified; direct POSIX reporting-rule quotation not retrieved; native tuple UNKNOWN'};
  fs.writeFileSync(path.join(own,'RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(own,'RECEIPT.json'))).digest('hex');
  fs.writeSync(capture,JSON.stringify({event:'complete',sha256})+'\n');console.log(sha256);
}catch(error){fs.writeSync(capture,JSON.stringify({event:'failure',message:String(error)})+'\n');process.exitCode=1;}
finally{fs.fsyncSync(capture);fs.closeSync(capture);}
