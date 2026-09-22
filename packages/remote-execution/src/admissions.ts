import * as nodeFs from'node:fs/promises';import{createHash,randomUUID}from'node:crypto';
import{UploadError}from'./upload-protocol.js';
import type {EffectReceipt} from './wire.generated.js';
import type {JobStateEvent} from './job-state.js';
import {validateWire} from './wire-validation.js';
export interface AdmissionRecord {operationId:string;epoch:string;tenantId:string;principalId:string;sessionId?:string;kind:string;requestDigest:string;buildDigest?:string;jobState?:JobStateEvent;effectReceipt?:EffectReceipt;retainedUntil?:number}
export interface AdmissionStore {record(value:AdmissionRecord):Promise<void>;inspect(operationId:string):Promise<AdmissionRecord|null>;sweep?(now:number):Promise<void>}
type LedgerFs=Pick<typeof nodeFs,'lstat'|'realpath'|'open'|'link'|'unlink'|'readFile'|'readdir'>;
/** Durable immutable admission records for one operator-owned, private, single-
 * writer filesystem. Publish by no-replace hardlink after fsync, then fsync the
 * directory. No record contains env values, argv, URLs, credentials or media data.
 * This proves admission, never attachment or exactly-once native execution. */
export function createDiskAdmissionStore(options:{root:string;fs?:LedgerFs;ownerId?:number;maxRecordBytes:number;maxRecords?:number}):AdmissionStore {
 const fs=options.fs??nodeFs;const ownerId=options.ownerId??process.getuid?.();const capacity=options.maxRecords??100000;
 if(!options.root.startsWith('/')||options.root.endsWith('/')||!Number.isSafeInteger(options.maxRecordBytes)||options.maxRecordBytes<1||!Number.isSafeInteger(capacity)||capacity<1)throw new TypeError('Invalid admission ledger configuration');
 let tail:Promise<unknown>=Promise.resolve();
 async function check(){const stat=await fs.lstat(options.root);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==ownerId||(stat.mode&0o077)!==0||await fs.realpath(options.root)!==options.root)throw new TypeError('Admission root must be private and operator-owned');}
 function path(id:string){if(typeof id!=='string'||!id||id.length>256)throw new TypeError('Invalid admission identity');return options.root+'/'+createHash('sha256').update(id).digest('hex')+'.json';}
 function validate(value:AdmissionRecord){if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['operationId','epoch','tenantId','principalId','sessionId','kind','requestDigest','buildDigest','jobState','effectReceipt','retainedUntil'].includes(k)))throw new TypeError('Invalid admission record');
  for(const field of ['operationId','epoch','tenantId','principalId','kind']as const)if(typeof value[field]!=='string'||!value[field]||value[field].length>256)throw new TypeError('Invalid admission record');
  if(value.retainedUntil!==undefined&&(!Number.isSafeInteger(value.retainedUntil)||value.retainedUntil<0))throw new TypeError('Invalid admission retention deadline');
  if(value.effectReceipt!==undefined)validateWire('EffectReceipt',value.effectReceipt);
  if(value.jobState!==undefined)validateWire('JobStateEvent',value.jobState);
  for(const hash of [value.requestDigest,...(value.buildDigest?[value.buildDigest]:[])])if(typeof hash!=='string'||hash.length!==64||Array.from(hash).some(c=>!'0123456789abcdef'.includes(c)))throw new TypeError('Invalid admission digest');
 }
 async function inspect(operationId:string):Promise<AdmissionRecord|null>{await check();const target=path(operationId);let stat;try{stat=await fs.lstat(target);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>options.maxRecordBytes)throw new TypeError('Admission record exceeds bound');const bytes=await fs.readFile(target);if(bytes.length>options.maxRecordBytes)throw new TypeError('Admission record exceeds bound');const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))as AdmissionRecord;validate(record);if(record.operationId!==operationId)throw new TypeError('Admission identity differs');return record;
 }
 function record(value:AdmissionRecord):Promise<void>{validate(value);value=structuredClone(value);const bytes=new TextEncoder().encode(JSON.stringify(value));if(bytes.length>options.maxRecordBytes)return Promise.reject(new TypeError('Admission record exceeds bound'));
  const work=tail.then(async()=>{await check();const existing=await inspect(value.operationId);if(existing){if(JSON.stringify(existing)!==JSON.stringify(value))throw new UploadError(409,'Admission recovery conflict');return;}
   if((await fs.readdir(options.root)).length>=capacity)throw new UploadError(429,'Admission storage count bound');const temporary=options.root+'/.pending-'+randomUUID();const file=await fs.open(temporary,'wx',0o600);
   try{try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    try{await fs.link(temporary,path(value.operationId));}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const published=await inspect(value.operationId);if(JSON.stringify(published)!==JSON.stringify(value))throw new UploadError(409,'Admission recovery conflict');}
   }finally{await fs.unlink(temporary);const directory=await fs.open(options.root,'r');try{await directory.sync();}finally{await directory.close();}}
  });tail=work.catch(()=>{});return work;
 }
 function sweep(now:number):Promise<void>{
  if(!Number.isSafeInteger(now)||now<0)return Promise.reject(new TypeError('Invalid cleanup time'));
  const work=tail.then(async()=>{await check();let removed=false;
   for(const name of await fs.readdir(options.root)){
    if(typeof name!=='string'||name.length!==69||!name.endsWith('.json'))continue;
    const target=options.root+'/'+name;const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>options.maxRecordBytes)throw new TypeError('Invalid cleanup record');
    const bytes=await fs.readFile(target);if(bytes.length>options.maxRecordBytes)throw new TypeError('Cleanup record exceeds bound');const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as AdmissionRecord;validate(value);
    if(path(value.operationId)!==target)throw new TypeError('Cleanup identity differs');
    if(value.retainedUntil!==undefined&&value.retainedUntil<=now){await fs.unlink(target);removed=true;}
   }
   if(removed){const directory=await fs.open(options.root,'r');try{await directory.sync();}finally{await directory.close();}}
  });tail=work.catch(()=>{});return work;
 }
 return{record,inspect,sweep};
}
