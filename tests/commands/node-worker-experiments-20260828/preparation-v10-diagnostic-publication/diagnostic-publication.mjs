import { types } from 'node:util';
import { jsonSize } from './json-size.mjs';
export const DIAGNOSTIC_RESERVATION = 1048576;
export const DIAGNOSTIC_BYTES = 8192;
const fieldNames = ['name','message','code','errno','syscall','path','dest','stack','cause'];
const vocabulary = { name:'FsError', message:"ENOENT: no such file or directory, readFile '/missing'", code:'ENOENT', errno:-2, syscall:'readFile', path:'/missing' };
const provenances = ['caller','escaping-parent','late-parent-secondary','undelivered-parent','cleanup','worker-control','capture-control','construction-control','termination-control'];
function data(value,key) {
  const descriptor = Object.getOwnPropertyDescriptor(value,key);
  if (!descriptor || !Object.hasOwn(descriptor,'value')) throw Error('diagnostic own data');
  return descriptor.value;
}
export function observeKnownReason(value) {
  const report = { kind:typeof value, disposition:'opaque', fields:{} };
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return report;
  if (types.isProxy(value)) { report.disposition='proxy-not-inspected';return report; }
  if (!types.isNativeError(value)) return report;
  report.disposition='native-error-shape-not-provenance';
  for (const field of fieldNames) {
    const descriptor = Object.getOwnPropertyDescriptor(value,field);
    if (!descriptor) { report.fields[field]={shape:'absent'};continue; }
    if (!Object.hasOwn(descriptor,'value')) { report.fields[field]={shape:'accessor',guard:field==='stack'?'ignored-nontransported':'own-data-required'};continue; }
    const item=descriptor.value;
    const type=item===null?'null':typeof item;
    const known=Object.hasOwn(vocabulary,field)&&Object.is(vocabulary[field],item);
    report.fields[field]=known?{shape:'data',type,value:item}:{shape:'data',type,redacted:item!==undefined};
  }
  return report;
}
function admittedRaw(raw) {
  if (raw === null || typeof raw !== 'object' || types.isProxy(raw) || !Array.isArray(raw)) throw Error('diagnostic raw array');
  const length=data(raw,'length');
  if (!Number.isSafeInteger(length)||length<0||length>4) throw Error('diagnostic raw count');
  const keys=Reflect.ownKeys(raw);
  if(keys.length!==length+1||keys.at(-1)!=='length')throw Error('diagnostic raw extras');
  for(let index=0;index<length;index++) {
    if(keys[index]!==String(index))throw Error('diagnostic raw hole');
    const record=data(raw,String(index));
    if(record===null||typeof record!=='object'||types.isProxy(record))throw Error('diagnostic raw record');
    const names=Reflect.ownKeys(record);
    if(names.length!==3||!['present','value','provenance'].every(key=>names.includes(key)))throw Error('diagnostic raw keys');
    if(data(record,'present')!==true||!provenances.includes(data(record,'provenance')))throw Error('diagnostic raw admission');
    data(record,'value');
  }
  return length;
}
export async function publishDiagnostics(raw,ledger,write,beforeObserve=()=>{}) {
  const faults=[];
  let owned=false,bytes=null,report=null,published=false;
  try {
    ledger.reserve('diagnostic-publication',DIAGNOSTIC_RESERVATION);owned=true;
    const length=admittedRaw(raw);
    beforeObserve();
    report={schema:'wrq-diagnostic-v1',rawCount:length,records:{},scope:'shape-only-not-origin-or-reason-identity'};
    for(let index=0;index<length;index++) {
      const record=data(raw,String(index));
      report.records[String(index)]={provenance:data(record,'provenance'),present:true,observation:observeKnownReason(data(record,'value'))};
    }
    const count=jsonSize(report,DIAGNOSTIC_BYTES-1)+1;
    const encoded=JSON.stringify(report)+'\n';
    if(Buffer.byteLength(encoded)!==count)throw Error('diagnostic byte measurement');
    bytes=Buffer.from(encoded);
    await write(bytes);
    published=true;
  } catch(value) { faults.push({present:true,value,stage:'diagnostic-observe-or-publication'}); }
  finally {
    bytes=null;report=null;
    if(owned)try{ledger.release('diagnostic-publication');}catch(value){faults.push({present:true,value,stage:'diagnostic-release'});}
  }
  return {raw,published,complete:published&&faults.length===0,faults};
}
