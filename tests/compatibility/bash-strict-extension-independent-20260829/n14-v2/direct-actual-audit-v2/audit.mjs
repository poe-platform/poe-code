import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const author='/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-surface-independent-20260829/virtual-comparison-direct-activation-v2';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(file,pin,maximum=2097152){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size!==pin.bytes||stat.size>maximum)throw Error('type/size '+file);const bytes=fs.readFileSync(file);if(bytes.length!==pin.bytes||hash(bytes)!==pin.sha256)throw Error('identity '+file);return bytes;}
function recordBytes(record){if(!record||typeof record.base64!=='string'||!Number.isSafeInteger(record.bytes))throw Error('invalid byte record');const bytes=Buffer.from(record.base64,'base64');if(bytes.toString('base64')!==record.base64||bytes.length!==record.bytes||hash(bytes)!==record.sha256)throw Error('byte record mismatch');return bytes;}
const input=JSON.parse(fs.readFileSync(process.argv[2]));
const old=JSON.parse(read(input.previousIndex.path,input.previousIndex));
const frames=new Map();let frameBytes=0;
for(const pin of old.frameIndex){if(path.isAbsolute(pin.path)||pin.path.split('/').includes('..')||frames.has(pin.path))throw Error('frame namespace');const bytes=read(path.join(input.rawRoot,pin.path),pin);frameBytes+=bytes.length;frames.set(pin.path,pin);}
const byHash=new Map([...frames.values()].map(pin=>[pin.sha256,pin]));
const frame=pin=>read(path.join(input.rawRoot,pin.path),pin);
const manifest=JSON.parse(read(path.join(path.dirname(root),'direct-actual-audit-v1/capture/manifest.raw'),{bytes:2684,sha256:'b67a32f83a604a948e18f87fffbe327eb7fc20196fe540ede7ec0cbd86593976'}));
const load=name=>JSON.parse(read(path.join(author,'actual-run-v1',name),manifest.files[name]));
const outcomes=load('OUTCOME-MATRIX.json'),membership=load('MEMBERSHIP.json');
const sealPath=path.join(author,'EXECUTABLE-SEAL.json');
const sealStat=fs.lstatSync(sealPath);if(!sealStat.isFile()||sealStat.size>65536)throw Error('seal type/size');
const sealBytes=fs.readFileSync(sealPath);if(hash(sealBytes)!=='6324119804436e77ee90c35676fe6d46d5c6a14b3a63c7528034faef3c062252')throw Error('shipping seal');
const seal=JSON.parse(sealBytes);for(const [name,pin]of Object.entries(seal.files))read(path.join(author,name),pin);
const native=JSON.parse(read(path.join(author,'profile/MATRIX.json'),seal.files['profile/MATRIX.json']));
const checks=[];const check=(name,pass)=>checks.push({name,pass:pass===true});
const good={bytes:1,base64:'AA==',sha256:hash(Buffer.from([0]))};const controls=[];
for(const [name,value]of [['wrong bytes',{...good,bytes:2}],['wrong hash',{...good,sha256:'0'.repeat(64)}],['noncanonical framing',{...good,base64:'AA==\n'}],['missing presence',{bytes:1,sha256:good.sha256}]] ){let refused=false;try{recordBytes(value);}catch{refused=true;}controls.push({name,pass:refused});}
controls.push({name:'valid NUL byte',pass:recordBytes(good).equals(Buffer.from([0]))},{name:'false status is not zero',pass:!isDeepStrictEqual(false,0)},{name:'file mode difference retained',pass:!isDeepStrictEqual([{mode:420}],[{mode:438}])},{name:'stderr difference retained',pass:!Buffer.from('a').equals(Buffer.from('b'))});
check('678 exact frames and aggregate bytes',frames.size===678&&frameBytes===35655081);
const rows=[],differences=[];
for(const row of outcomes.rows){
  const pin=byHash.get(row.receiptSha256),child=membership.childRows.find(child=>child.id===row.id);if(!pin||!child)throw Error('missing exact receipt/child');
  const wrapper=JSON.parse(frame(pin)),receipt=wrapper.receipt;
  check(row.id+' outer schema',isDeepStrictEqual(Object.keys(wrapper).sort(),['id','layout','caseId','receipt','lifecycle','loadTrace','qualification'].sort())&&wrapper.id===row.id&&wrapper.caseId===row.caseId&&wrapper.layout===row.layout);
  check(row.id+' inner identity',receipt.caseId===row.caseId&&receipt.layout===row.layout);
  check(row.id+' receipt equals published virtual outcome V2',isDeepStrictEqual(receipt.observation,row.virtual));
  const stdout=child.captures.find(value=>value.kind==='stdout'),stderr=child.captures.find(value=>value.kind==='stderr');
  check(row.id+' raw stdout parsed receipt V2',isDeepStrictEqual(JSON.parse(recordBytes(stdout).toString('utf8')),receipt));
  check(row.id+' raw helper stderr empty',recordBytes(stderr).length===0);
  check(row.id+' raw program hash',hash(Buffer.from(row.program))===row.programSha256);
  const nativeCase=native.cases.find(value=>value.id===row.caseId);if(!nativeCase)throw Error('missing native identity');
  check(row.id+' unchanged native program',nativeCase.program===row.program&&nativeCase.programSha256===row.programSha256);
  for(const key of ['status','stdout','stderr','filesBefore','filesAfter'])check(row.id+' native '+key+' preserved',isDeepStrictEqual(nativeCase.nativeObservation[key],row.native[key]));
  const comparison={stdout:recordBytes(row.native.stdout).equals(recordBytes(row.virtual.stdout)),stderr:recordBytes(row.native.stderr).equals(recordBytes(row.virtual.stderr)),status:isDeepStrictEqual(row.native.status,row.virtual.status),filesBefore:isDeepStrictEqual(row.native.filesBefore,row.virtual.filesBefore),filesAfter:isDeepStrictEqual(row.native.filesAfter,row.virtual.filesAfter)};
  const equal=Object.values(comparison).every(value=>value===true);
  check(row.id+' independent comparison',isDeepStrictEqual(comparison,row.comparison)&&equal===row.allRawEqual);
  check(row.id+' public settlement',row.virtual.publicSettlement.execObserved===true&&row.virtual.publicSettlement.disposeSettled===true&&row.virtual.publicSettlement.disposeRejected===false&&isDeepStrictEqual(row.virtual.publicSettlement.events,['exec-started','exec-resolved','dispose-started','dispose-resolved'])&&row.virtual.cleanup.settled===true&&!row.virtual.hasPrimary&&!row.virtual.hasCleanupError);
  rows.push({id:row.id,caseId:row.caseId,layout:row.layout,equal,comparison});if(!equal&&row.layout==='source-built')differences.push({id:row.caseId,program:row.program,native:row.native,virtual:row.virtual,comparison});
}
for(const child of membership.childRows){
  const names=child.events.map(event=>event.name);
  if(!child.exit||!child.close||!child.stdoutEOF||!child.stderrEOF||child.knownOutstanding!==0)throw Error('KNOWN_RETIREMENT_STOP '+child.id);
  check(child.id+' retired lifecycle',child.exit===true&&child.close===true&&child.stdoutEOF===true&&child.stderrEOF===true&&child.knownOutstanding===0&&!child.forced&&child.signals.length===0&&child.status===0&&child.signal===null&&!child.primaryPresent&&child.secondary.length===0);
  check(child.id+' capture before spawn',names.indexOf('capture-open')>=0&&names.indexOf('capture-open')<names.indexOf('spawn')&&names.indexOf('listeners-enrolled')<names.indexOf('spawn'));
  for(const capture of child.captures)check(child.id+' '+capture.kind+' raw frame',byHash.has(hash(recordBytes(capture)))&&capture.closed===true&&capture.flushed===true);
}
for(const trace of membership.caseTraces){const pin=byHash.get(trace.traceSha256);check(trace.id+' trace identity',Boolean(pin)&&pin.bytes===trace.traceBytes);check(trace.id+' no unexpected trace',Array.isArray(trace.unexpectedEvents)&&trace.unexpectedEvents.length===0);const role=frames.get(trace.id+'.role.json');check(trace.id+' role identity',Boolean(role)&&role.sha256===trace.roleSha256);}
const result={at:new Date().toISOString(),schema:'virtual37-independent-data-readjudication-v2',candidate:manifest.candidate,packageSha256:manifest.archiveSha256,rawFrames:frames.size,rawBytes:frameBytes,observations:rows.length,equal:rows.filter(row=>row.equal).length,different:rows.filter(row=>!row.equal).length,checks:checks.length,passed:checks.filter(row=>row.pass).length,failed:checks.filter(row=>!row.pass),controls,rows,differingIds:differences.map(row=>row.id),shippingFiles:Object.keys(seal.files).length,knownManagedChildren:membership.childRows.length,publicSettlements:membership.caseTraces.length,postflightEvidence:membership.postflight,archiveAdmissionEvidence:membership.archiveAdmission,oldFailure:{commit:'05707e3b0011864154707266f2375d88cf80c6a1',assertions:222,exit:1,preserved:true},qualification:'Fresh DATA mapping proof, not product rerun; historical final-accounting HOLD remains. Known direct retirement, no group/hidden-job/global census.',noInflation:true};
fs.writeFileSync(path.join(root,'RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(root,'DIFFERENCES.json'),JSON.stringify(differences,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...result,rows:undefined,postflightEvidence:undefined,archiveAdmissionEvidence:undefined},null,2));
if(result.failed.length||controls.some(row=>!row.pass))process.exitCode=1;
