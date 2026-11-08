import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const boundedText=(value,max)=>typeof value==='string'&&value.length<=max?value:undefined;
function pathIdentity(value){if(typeof value!=='string'||value.length>2048)return undefined;if(value.startsWith('/usr/lib/')||value.startsWith('/System/Library/')||value==='/usr/bin/sandbox-exec'||/^\/Users\/(?:USER|kjopek)\/.*\/node$/.test(value))return value;return '[non-whitelisted path omitted]';}
function redact(text){return text.replace(/\/(?:[^\s"'<>(),;])+/g,token=>pathIdentity(token));}
export function selectStartupFields(report){
  if(report.pid!==17408)fail('RECORD_PID_MISMATCH');
  const selected={pid:report.pid,termination:{namespace:boundedText(report.termination?.namespace,128),code:report.termination?.code,indicator:typeof report.termination?.indicator==='string'?redact(report.termination.indicator.slice(0,2048)):undefined,flags:report.termination?.flags},applicationSpecificPresent:report.asi!==undefined,applicationReasons:[],omittedApplicationMessages:0,faultingThreadIndex:report.faultingThread,frames:[],images:[]};
  if(report.asi!==undefined){if(!report.asi||typeof report.asi!=='object'||Array.isArray(report.asi))fail('APPLICATION_REASON_SHAPE');for(const [context,values]of Object.entries(report.asi)){if(!Array.isArray(values))continue;for(const message of values){if(typeof message!=='string'||(!/(dyld|ignition|sandbox|secinit|libsystem)/i.test(context)&&!/(abort|dyld|ignition|sandbox|secinit|initializ|librar|launch|loader|permission|denied|failed|failure|operation not permitted)/i.test(message))){selected.omittedApplicationMessages++;continue;}if(message.length>2048||selected.applicationReasons.length>=8)fail('APPLICATION_REASON_LIMIT');selected.applicationReasons.push({context:context.split('/').at(-1)?.slice(0,128),message:redact(message)});}}}
  if(!Number.isInteger(report.faultingThread)||!Array.isArray(report.threads)||report.faultingThread<0||report.faultingThread>=report.threads.length){selected.frameQualification='FAULTING_THREAD_INDEX_MISSING_OR_AMBIGUOUS';return selected;}
  const thread=report.threads[report.faultingThread];if(!Array.isArray(thread.frames)){selected.frameQualification='FAULTING_THREAD_FRAMES_MISSING';return selected;}
  const images=Array.isArray(report.usedImages)?report.usedImages:[];const needed=new Set();
  for(const [position,frame]of thread.frames.slice(0,8).entries()){
    if(!Number.isInteger(frame.imageIndex)||frame.imageIndex<0||frame.imageIndex>=images.length)fail('FRAME_IMAGE_INDEX');
    if(frame.imageOffset!==undefined&&(!Number.isSafeInteger(frame.imageOffset)||frame.imageOffset<0))fail('FRAME_IMAGE_OFFSET');
    if(frame.symbolLocation!==undefined&&(!Number.isSafeInteger(frame.symbolLocation)||frame.symbolLocation<0))fail('FRAME_SYMBOL_OFFSET');
    needed.add(frame.imageIndex);selected.frames.push({position,imageIndex:frame.imageIndex,imageOffset:frame.imageOffset,symbol:typeof frame.symbol==='string'?redact(frame.symbol.slice(0,512)):undefined,symbolLocation:frame.symbolLocation});
  }
  if(needed.size>8)fail('IMAGE_LIMIT');
  for(const index of needed){const image=images[index];selected.images.push({imageIndex:index,name:boundedText(image.name,256),path:pathIdentity(image.path),uuid:boundedText(image.uuid,64),arch:boundedText(image.arch,32)});}
  selected.frameQualification='ONLY_FIRST_UP_TO_EIGHT_FAULTING_THREAD_FRAMES';return selected;
}
export async function acquire(plan,publish){
  let handle;const result={schema:'d03-startup-fields-v3',status:'STARTED',rawRecordCaptured:false,reads:0,closedHandles:0};
  const check=()=>{if(Date.now()>=plan.deadline)fail('DEADLINE');};
  try{
    check();await publish({event:'EXACT_RECORD_ADMISSION',path:plan.record.path,expectedBytes:plan.record.bytes,expectedSha256:plan.record.sha256});
    const before=await fs.lstat(plan.record.path);if(!before.isFile()||before.isSymbolicLink()||before.size!==plan.record.bytes)fail('RECORD_METADATA_DRIFT');
    handle=await fs.open(plan.record.path,constants.O_RDONLY|constants.O_NOFOLLOW);const opened=await handle.stat();if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)fail('RECORD_OPEN_DRIFT');
    const bytes=Buffer.alloc(plan.record.bytes),hash=createHash('sha256');let position=0;
    while(position<bytes.length){check();const read=await handle.read(bytes,position,Math.min(65536,bytes.length-position),position);if(!read.bytesRead)fail('SHORT_RECORD');hash.update(bytes.subarray(position,position+read.bytesRead));position+=read.bytesRead;}
    result.reads=1;result.readBytes=position;const sha256=hash.digest('hex');const after=await handle.stat();if(after.dev!==opened.dev||after.ino!==opened.ino||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||sha256!==plan.record.sha256)fail('RECORD_HASH_OR_IDENTITY_DRIFT');
    result.rawIdentity={bytes:position,sha256,device:after.dev,inode:after.ino};await publish({event:'HASH_IDENTITY_MATCHED',...result.rawIdentity});
    const newline=bytes.indexOf(10);if(newline<0)fail('IPS_FORMAT');const metadata=JSON.parse(bytes.subarray(0,newline).toString('utf8'));if(String(metadata.bug_type)!=='309')fail('CRASH_SCHEMA');const report=JSON.parse(bytes.subarray(newline+1).toString('utf8'));bytes.fill(0);
    result.selected=selectStartupFields(report);result.status=result.selected.frameQualification==='ONLY_FIRST_UP_TO_EIGHT_FAULTING_THREAD_FRAMES'?'SELECTED_FIELDS_ACQUIRED':'PARTIAL_IDENTITY_OR_FRAMES';await publish({event:'SELECTED_STARTUP_FIELDS',selected:result.selected});
  }catch(error){result.status='STOP';result.errorCode=typeof error.code==='string'?error.code:'PARSE_OR_HELPER_FAILURE';await publish({event:'STOP',code:result.errorCode});}
  finally{if(handle){await handle.close();result.closedHandles=1;}result.openHandles=0;await publish({event:'READER_CLOSED',closedHandles:result.closedHandles});}
  return result;
}
